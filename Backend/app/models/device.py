from typing import Literal
from pydantic import BaseModel

DeviceState = Literal["ready", "tracking", "listening", "warning", "offline"]


# Mirrors src/types/device.ts -> DeviceStatus exactly.
class DeviceStatus(BaseModel):
    camera: DeviceState
    hands: DeviceState
    face: DeviceState
    microphone: DeviceState
    speaker: DeviceState
    ai: DeviceState
    lightLevel: DeviceState
