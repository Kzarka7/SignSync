import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from app.recognition import SignRequest, get_recognizer
from app.ws.manager import manager

router = APIRouter()
logger = logging.getLogger('signsync.ws')


@router.websocket('/ws/translate')
async def translate_socket(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_json({'type': 'status', 'payload': {'state': 'loading', 'message': 'Loading v5 recognition...'}})
        try:
            recognizer = await asyncio.to_thread(get_recognizer)
        except Exception:
            logger.exception('Unable to load v5 artifacts')
            await websocket.send_json({'type': 'error', 'payload': {'message': 'V5 model unavailable. Check backend dependencies and the SignSync Dataset folder.'}})
            await websocket.close(code=1011)
            return
        await websocket.send_json({'type': 'status', 'payload': {
            'state': 'ready', 'message': 'V5 recognition ready', 'model': 'v5-nine-run-ensemble',
            'runs': [member[0] for member in recognizer.members],
        }})
        seen = set()
        while True:
            raw = await websocket.receive_text()
            if len(raw) > 2_000_000:
                await websocket.close(code=1009)
                return
            request_id = None
            try:
                data = json.loads(raw)
                if not isinstance(data, dict):
                    raise ValueError('Expected a request object.')
                if data.get('type') == 'control':
                    if data.get('action') == 'end-session':
                        await websocket.close(code=1000)
                        return
                    continue
                if data.get('type') != 'sign':
                    raise ValueError('Unknown recognition request.')
                request = SignRequest.model_validate(data.get('payload'))
                request_id = request.requestId
                if request_id in seen:
                    raise ValueError('This recording has already been processed.')
                if len(seen) >= 1000:
                    raise ValueError('Session limit reached. Start a new conversation.')
                result = await asyncio.to_thread(recognizer.predict, request)
                seen.add(request_id)
                await websocket.send_json({'type': 'prediction', 'payload': result})
            except ValueError as exc:
                message = 'Malformed recording. Record the sign again.' if isinstance(exc, ValidationError) else str(exc)
                await websocket.send_json({'type': 'error', 'payload': {'requestId': request_id, 'message': message}})
            except Exception:
                logger.exception('V5 inference failed')
                await websocket.send_json({'type': 'error', 'payload': {'requestId': request_id, 'message': 'Recognition failed. Please try again.'}})
    except WebSocketDisconnect:
        logger.info('Recognition client disconnected')
    finally:
        manager.disconnect(websocket)
