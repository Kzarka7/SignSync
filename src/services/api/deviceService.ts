import { DeviceStatus } from '../../types/device'
import { apiFetch, mockDelay, USE_MOCKS } from './client'
import mockStatus from '../../mocks/deviceStatus.json'

// Future FastAPI route: GET /api/device/status
// (An initial snapshot only - live updates come from the WebSocket stream,
// see services/ws/translationSocket.ts)
export async function getDeviceStatusSnapshot(): Promise<DeviceStatus> {
  if (USE_MOCKS) {
    return mockDelay(mockStatus as DeviceStatus)
  }
  return apiFetch<DeviceStatus>('/device/status')
}
