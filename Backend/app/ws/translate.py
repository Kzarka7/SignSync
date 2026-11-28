import asyncio
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError
from app.recognition import SignRequest, get_recognizer, get_diagnostic_recognizer, LAB_EXPERIMENTS
from app.ws.manager import manager

router = APIRouter()
logger = logging.getLogger('signsync.ws')


@router.websocket('/ws/translate')
async def translate_socket(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        mode = websocket.query_params.get('model', 'v5')
        if mode not in ('v5', 'p4-candidate', *LAB_EXPERIMENTS):
            await websocket.send_json({'type': 'error', 'payload': {'message': 'Unknown recognition model.'}})
            await websocket.close(code=1008)
            return
        name = {'v5': 'V5', 'p4-candidate': 'P4 candidate',
                'lab-grouped': 'Previous pilot', 'lab-clip': 'Current pilot', 'lab-alphabet': 'Alphabet pilot',
                'lab-stage2': 'Alphabet and numbers joint pilot', 'lab-signs38': '38-sign grouped pilot',
                'lab-signs38-clip': '38-sign 70/15/15 pilot', 'lab-signs33': '33-sign days-of-the-week pilot',
                'lab-signs43-numbers': '43-sign days-and-numbers pilot',
                'lab-signs43-shape-motion': '43-sign handshape-and-motion pilot',
                'lab-signs43-similarity': '43-sign similar-signs pilot',
                'lab-signs43-motion-e': '43 Similar Signs motion E candidate',
                'lab-signs43-similarity-v2': '43 Similar Signs v2',
                'lab-signs75-candidate': '75-sign held-out batch experiment',
                'lab-signs75-multi-batch': '75-sign multi-batch candidate',
                'lab-signs32-standalone': '32-sign standalone v3',
                'lab-signs32-standalone-v4': '32-sign standalone v4',
                'lab-signs32-standalone-v5': '32-sign standalone v5',
                'lab-signs32-standalone-v5-motion': '32-sign standalone v5 motion + augmentation',
                'lab-signs32-similarity': '32-sign similarity recipe',
                'lab-ix-poss-pilot': 'Indexing and possessives first pilot',
                'lab-ix-poss-motion': 'Indexing and possessives motion v1',
                'lab-signs74-combined': '74-sign combined v3',
                'lab-signs74-motion-e': '74-sign combined motion E candidate',
                'lab-signs74-motion-e-v2': '74-sign combined motion E v2 (live-crop) candidate',
                'lab-signs74-motion-e-v2-fusion': '74-sign v2 + Motion E fusion candidate',
                'lab-signs74-motion-e-v4': '74-sign combined motion E v4 (refreshed TUESDAY/THURSDAY) candidate'}[mode]
        diagnostics = websocket.query_params.get('diagnostics', '0')
        if (diagnostics not in ('0', '1') or (diagnostics == '1' and mode == 'v5') or
                (mode in LAB_EXPERIMENTS and diagnostics != '1')):
            await websocket.send_json({'type': 'error', 'payload': {'message': 'Select a supported diagnostic model.'}})
            await websocket.close(code=1008)
            return
        await websocket.send_json({'type': 'status', 'payload': {'state': 'loading', 'message': f'Loading {name} recognition...'}})
        try:
            if mode in LAB_EXPERIMENTS:
                recognizer = await asyncio.to_thread(get_diagnostic_recognizer, mode)
            else:
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
            if getattr(recognizer, 'supports_short_preview', False):
                ready_payload['supportsShortPreview'] = True
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
