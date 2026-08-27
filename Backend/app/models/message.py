from typing import Literal
from pydantic import BaseModel

MessageSource = Literal["sign", "speech"]


# Mirrors src/types/message.ts -> ConversationMessage.
class ConversationMessage(BaseModel):
    id: str
    sessionId: str
    source: MessageSource
    text: str
    timestamp: str  # ISO 8601
    confidence: int  # 0-100, from the ML model


# Mirrors src/types/device.ts -> DeviceStatus, used as the "status" event
# payload over the WebSocket (see ws/translate.py).
class DeviceStatusEvent(BaseModel):
    camera: str | None = None
    hands: str | None = None
    face: str | None = None
    microphone: str | None = None
    speaker: str | None = None
    ai: str | None = None
    lightLevel: str | None = None


class ErrorPayload(BaseModel):
    message: str


# Mirrors src/types/message.ts -> TranslationSocketEvent. `payload` is
# deliberately loose here (frontend narrows on `type`) - FastAPI/Pydantic
# will serialize whichever concrete payload object is passed in.
class TranslationSocketEvent(BaseModel):
    type: Literal["translation", "status", "error"]
    payload: ConversationMessage | DeviceStatusEvent | ErrorPayload


# Mirrors the shape of control messages the frontend's RealTranslationSocket
# sends via socket.send(JSON.stringify({ type: 'control', action })).
class ControlMessage(BaseModel):
    type: Literal["control"]
    action: str  # "end-session" | "export" today; kept as str so new
    # actions (e.g. a future "submit-speech") don't require a backend
    # schema change.
