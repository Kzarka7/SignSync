from app.models.message import ConversationMessage

# Seeded with the same values as src/mocks/messages.json. The "live-demo"
# sessionId matches what the frontend's mock socket/session currently uses.
MESSAGES: list[ConversationMessage] = [
    ConversationMessage(
        id="m1", sessionId="live-demo", source="sign",
        text="I need assistance.",
        timestamp="2026-07-08T10:12:03+08:00", confidence=98,
    ),
    ConversationMessage(
        id="m2", sessionId="live-demo", source="speech",
        text="How may I help you today?",
        timestamp="2026-07-08T10:12:09+08:00", confidence=99,
    ),
    ConversationMessage(
        id="m3", sessionId="live-demo", source="sign",
        text="My chest hurts, since this morning.",
        timestamp="2026-07-08T10:12:22+08:00", confidence=82,
    ),
    ConversationMessage(
        id="m4", sessionId="live-demo", source="speech",
        text="Please follow me to the triage room.",
        timestamp="2026-07-08T10:12:30+08:00", confidence=97,
    ),
]
