from fastapi import APIRouter
from app.models.device import DeviceStatus
from app.data.device import DEVICE_STATUS

router = APIRouter(prefix="/device", tags=["device"])


# Matches getDeviceStatusSnapshot() in deviceService.ts. This is the
# one-time REST snapshot; live updates during a session arrive over the
# WebSocket as `{ type: 'status', payload: DeviceStatusEvent }` instead
# (see ws/translate.py) - the REST route stays for the initial page load
# before the socket connects.
@router.get("/status", response_model=DeviceStatus)
def get_device_status():
    return DEVICE_STATUS
