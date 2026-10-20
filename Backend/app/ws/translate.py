import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from app.recognition import SignRequest, get_recognizer, get_diagnostic_recognizer
from app.ws.manager import manager

router = APIRouter()
logger = logging.getLogger('signsync.ws')


@router.websocket('/ws/translate')
async def translate_socket(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        mode = websocket.query_params.get('model', 'v5')
        if mode not in ('v5', 'p4-candidate'):
            await websocket.send_json({'type': 'error', 'payload': {'message': 'Unknown recognition model.'}})
            await websocket.close(code=1008)
            return
        name = 'P4 candidate' if mode == 'p4-candidate' else 'V5'
        diagnostics = websocket.query_params.get('diagnostics', '0')
        if diagnostics not in ('0', '1') or (diagnostics == '1' and mode != 'p4-candidate'):
            await websocket.send_json({'type': 'error', 'payload': {'message': 'Diagnostics require the optional P4 candidate.'}})
            await websocket.close(code=1008)
            return
        await websocket.send_json({'type': 'status', 'payload': {'state': 'loading', 'message': f'Loading {name} recognition...'}})
        try:
            recognizer = (await asyncio.to_thread(get_diagnostic_recognizer) if diagnostics == '1'
                          else await asyncio.to_thread(get_recognizer, mode))
        except Exception:
            logger.exception('Unable to load %s artifacts', name)
            await websocket.send_json({'type': 'error', 'payload': {'message': f'{name} model unavailable. Check backend dependencies and the SignSync Dataset folder, or select the current live model.'}})
            await websocket.close(code=1011)
            return
        ready_payload = {
            'state': 'ready', 'message': f'{name} recognition ready', 'model': mode,
            'runs': [member[0] for member in recognizer.members],
        }
        if diagnostics == '1':
            ready_payload.update({'diagnosticsProtocol': 1, 'recognizerId': recognizer.model_id, 'execution': 'graph'})
        await websocket.send_json({'type': 'status', 'payload': ready_payload})
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
                logger.exception('%s inference failed', name)
                await websocket.send_json({'type': 'error', 'payload': {'requestId': request_id, 'message': 'Recognition failed. Please try again.'}})
    except WebSocketDisconnect:
        logger.info('Recognition client disconnected')
    finally:
        manager.disconnect(websocket)
