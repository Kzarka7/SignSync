import { useEffect, useState } from 'react'
import { DeviceStatus } from '../types/device'
import { createCameraDetectionService } from '../services/media/cameraService'
import { getDeviceStatusSnapshot } from '../services/api/deviceService'

// Combines the initial REST snapshot with the live push stream from the
// camera/MediaPipe service, so components always render the latest state
// regardless of which source produced it.
export function useDeviceStatus() {
  const [status, setStatus] = useState<DeviceStatus | null>(null)

  useEffect(() => {
    let unsubscribe = () => {}

    getDeviceStatusSnapshot().then(setStatus)

    const service = createCameraDetectionService()
    unsubscribe = service.subscribe(setStatus)

    return () => unsubscribe()
  }, [])

  return status
}
