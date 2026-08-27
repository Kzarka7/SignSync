from app.models.session import ConversationSession

# In-memory stand-in for a database table. Seeded with the same values as
# src/mocks/sessions.json so switching VITE_USE_MOCKS=false changes nothing
# visible. Replace this module's storage with real DB queries (SQLAlchemy/
# SQLModel, etc.) later - routers/sessions.py is the only caller.
SESSIONS: list[ConversationSession] = [
    ConversationSession(
        id="s1",
        title="Hospital reception",
        location="Hospital",
        startedAt="2026-07-08T10:12:00+08:00",
        durationMinutes=14,
        messageCount=26,
        avgConfidence=96,
    ),
    ConversationSession(
        id="s2",
        title="Barangay office visit",
        location="Government office",
        startedAt="2026-07-07T15:45:00+08:00",
        durationMinutes=9,
        messageCount=15,
        avgConfidence=88,
    ),
    ConversationSession(
        id="s3",
        title="Classroom consultation",
        location="School",
        startedAt="2026-07-06T13:20:00+08:00",
        durationMinutes=22,
        messageCount=41,
        avgConfidence=95,
    ),
]
