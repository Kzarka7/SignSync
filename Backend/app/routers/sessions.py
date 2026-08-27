from fastapi import APIRouter, HTTPException, Query
from app.models.session import ConversationSession
from app.data.sessions import SESSIONS

router = APIRouter(prefix="/sessions", tags=["sessions"])


# GET /api/sessions and GET /api/sessions?limit=N both hit this route -
# matches getAllSessions() / getRecentSessions() in sessionsService.ts,
# which only differ by the limit query param.
@router.get("", response_model=list[ConversationSession])
def list_sessions(limit: int | None = Query(default=None, ge=1)):
    if limit is not None:
        return SESSIONS[:limit]
    return SESSIONS


@router.get("/{session_id}", response_model=ConversationSession)
def get_session(session_id: str):
    session = next((s for s in SESSIONS if s.id == session_id), None)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session
