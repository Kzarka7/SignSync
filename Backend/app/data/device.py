from app.models.device import DeviceStatus

# Seeded with the same values as src/mocks/deviceStatus.json. Once
# MediaPipe is wired up, GET /api/device/status should return the most
# recent snapshot the ML pipeline produced instead of this static object.
DEVICE_STATUS = DeviceStatus(
    camera="tracking",
    hands="tracking",
    face="tracking",
    microphone="listening",
    speaker="ready",
    ai="ready",
    lightLevel="warning",
)
