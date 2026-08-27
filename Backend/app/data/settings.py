from app.models.settings import AppSettings

# Seeded with the same values as src/mocks/settings.json. This is a
# process-global mutable object standing in for a per-user settings row in
# a real database - fine for a single-user capstone demo, not for
# production multi-user use.
_settings = AppSettings(
    theme="light",
    interfaceLanguage="en",
    voice="fil-male",
    highContrast=False,
    largeText=True,
    avatarSpeed=1,
    autoSaveConversations=True,
)


def get_settings() -> AppSettings:
    return _settings


def update_settings(partial: dict) -> AppSettings:
    global _settings
    _settings = _settings.model_copy(update={k: v for k, v in partial.items() if v is not None})
    return _settings
