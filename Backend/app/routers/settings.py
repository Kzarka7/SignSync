from fastapi import APIRouter
from app.models.settings import AppSettings, AppSettingsUpdate
from app.data.settings import get_settings, update_settings

router = APIRouter(prefix="/settings", tags=["settings"])


# Matches getSettings()/updateSettings() in settingsService.ts.
@router.get("", response_model=AppSettings)
def read_settings():
    return get_settings()


@router.put("", response_model=AppSettings)
def write_settings(partial: AppSettingsUpdate):
    return update_settings(partial.model_dump(exclude_unset=True))
