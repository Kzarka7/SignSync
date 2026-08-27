import { DeviceStatus, DeviceState } from '../../types/device'
import { USE_MOCKS } from '../api/client'
import mockStatus from '../../mocks/deviceStatus.json'

// The contract components depend on. A future MediaPipe Holistic
// integration implements the same interface - mapping landmark results
// (hands/face presence, frame brightness) into this DeviceStatus shape -
// so CameraPanel and DetectionStatusPanel never need to change.
export interface ICameraDetectionService {
  subscribe(callback: (status: DeviceStatus) => void): () => void // returns unsubscribe
}

const STATES: DeviceState[] = ['tracking', 'warning']

class MockCameraDetectionService implements ICameraDetectionService {
  subscribe(callback: (status: DeviceStatus) => void) {
    let current = mockStatus as DeviceStatus
    callback(current)

    const timer = setInterval(() => {
      // Nudges face/light occasionally so their warning banners have
      // something to demonstrate without a real face-detection model yet.
      // Hands/camera are driven by the real useCameraFeed hook instead -
      // see components/live/CameraPanel.tsx.
      current = {
        ...current,
        face: Math.random() > 0.85 ? 'warning' : STATES[0],
        lightLevel: Math.random() > 0.85 ? 'warning' : STATES[0],
      }
      callback(current)
    }, 6000)

    return () => clearInterval(timer)
  }
}

// Stub for the real integration:
//   1. Open the device camera via getUserMedia.
//   2. Feed frames into a MediaPipe Holistic instance.
//   3. Map landmark presence + frame luminance into DeviceStatus and call
//      the same `callback` signature the mock uses above.
class RealCameraDetectionService implements ICameraDetectionService {
  subscribe(callback: (status: DeviceStatus) => void) {
    console.warn('RealCameraDetectionService not yet implemented - pending MediaPipe integration')
    callback(mockStatus as DeviceStatus)
    return () => {}
  }
}

export function createCameraDetectionService(): ICameraDetectionService {
  return USE_MOCKS ? new MockCameraDetectionService() : new RealCameraDetectionService()
}
