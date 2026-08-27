from typing import Literal
from pydantic import BaseModel

Theme = Literal["light", "dark", "system"]
InterfaceLanguage = Literal["en", "fil"]
AvatarSpeed = Literal[0.75, 1, 1.25]


# Mirrors src/types/settings.ts -> AppSettings.
class AppSettings(BaseModel):
    theme: Theme
    interfaceLanguage: InterfaceLanguage
    voice: str
    highContrast: bool
    largeText: bool
    avatarSpeed: AvatarSpeed
    autoSaveConversations: bool


# All fields optional, for PUT /api/settings partial updates - mirrors the
# frontend's Partial<AppSettings> used in updateSettings().
class AppSettingsUpdate(BaseModel):
    theme: Theme | None = None
    interfaceLanguage: InterfaceLanguage | None = None
    voice: str | None = None
    highContrast: bool | None = None
    largeText: bool | None = None
    avatarSpeed: AvatarSpeed | None = None
    autoSaveConversations: bool | None = None
