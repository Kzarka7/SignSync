from fastapi import APIRouter
from app.models.message import ConversationMessage
from app.data.messages import MESSAGES

router = APIRouter(prefix="/sessions", tags=["messages"])


# Matches getMessagesForSession() in messagesService.ts.
@router.get("/{session_id}/messages", response_model=list[ConversationMessage])
def list_messages_for_session(session_id: str):
    return [m for m in MESSAGES if m.sessionId == session_id]
