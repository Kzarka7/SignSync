import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.data.messages import MESSAGES
from app.ws.manager import manager

router = APIRouter()
logger = logging.getLogger("signsync.ws")

# How often a new translated utterance is pushed to the client. Matches
# the 4-second cadence of the frontend's MockTranslationSocket, purely so
# the demo "feels" the same once the real socket takes over. Once the ML
# pipeline exists, replace the timed loop below with pipeline callbacks -
# push a translation event immediately whenever the model produces one.
EMIT_INTERVAL_SECONDS = 4


@router.websocket("/ws/translate")
async def translate_socket(websocket: WebSocket):
    await manager.connect(websocket)

    async def send_demo_translations():
        """Stand-in for the ML pipeline. Loops the same four demo
        messages the frontend mock uses, forever, so a fresh connection
        behaves identically to MockTranslationSocket. Delete this
        function once MediaPipe (sign->text) and a speech-to-text engine
        are producing real ConversationMessage events - call
        `await websocket.send_json(...)` from those callbacks instead."""
        index = 0
        while True:
            await asyncio.sleep(EMIT_INTERVAL_SECONDS)
            message = MESSAGES[index % len(MESSAGES)]
            event = {"type": "translation", "payload": message.model_dump()}
            await websocket.send_text(json.dumps(event))
            index += 1

    async def receive_control_messages():
        """Handles everything the client sends: today that's
        { type: 'control', action: 'end-session' | 'export' } from
        RealTranslationSocket.sendControl(). `action` is intentionally
        treated as an open string - a future submit-speech action (see
        the frontend AvatarPanel mic/submit flow) can be handled here by
        adding another `elif action == "submit-speech":` branch, without
        changing the message envelope or the frontend socket contract."""
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Received non-JSON WS message: %s", raw)
                continue

            if data.get("type") != "control":
                continue

            action = data.get("action")
            logger.info("Control action received: %s", action)

            if action == "end-session":
                # Hook point: persist the session, close out ML resources.
                pass
            elif action == "export":
                # Hook point: generate the export artifact (PDF/JSON) and
                # notify the client, e.g. via a `{ type: 'status', ... }`
                # event once that's part of the contract.
                pass

    send_task = asyncio.create_task(send_demo_translations())
    receive_task = asyncio.create_task(receive_control_messages())

    try:
        await asyncio.gather(send_task, receive_task)
    except WebSocketDisconnect:
        logger.info("Client disconnected from /ws/translate")
    finally:
        send_task.cancel()
        receive_task.cancel()
        manager.disconnect(websocket)
