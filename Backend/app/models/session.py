from pydantic import BaseModel


# Mirrors src/types/session.ts -> ConversationSession exactly (same field
# names) so the JSON returned here needs no reshaping on the frontend.
class ConversationSession(BaseModel):
    id: str
    title: str
    location: str
    startedAt: str  # ISO 8601
    durationMinutes: int
    messageCount: int
    avgConfidence: int  # 0-100
