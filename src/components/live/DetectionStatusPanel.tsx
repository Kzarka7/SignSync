import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import { CameraFeedState } from '../../hooks/useCameraFeed'
import { DeviceState } from '../../types/device'
import Card from '../shared/Card'
import StatusPill from '../shared/StatusPill'

const rows: { key: keyof NonNullable<ReturnType<typeof useDeviceStatus>>; label: string }[] = [
  { key: 'camera', label: 'Camera' },
  { key: 'hands', label: 'Hands' },
  { key: 'face', label: 'Face' },
  { key: 'lightLevel', label: 'Light' },
  { key: 'microphone', label: 'Microphone' },
  { key: 'speaker', label: 'Speaker' },
]

interface DetectionStatusPanelProps {
  feed: CameraFeedState
}

// Camera/Hands/Face/Light rows are overridden with real values from
// useCameraFeed; Microphone/Speaker still come from the mocked/REST
// device snapshot until those get their own real implementations.
export default function DetectionStatusPanel({ feed }: DetectionStatusPanelProps) {
  const status = useDeviceStatus()

  function resolveState(key: string, fallback: DeviceState): DeviceState {
    if (!feed.enabled && (key === 'camera' || key === 'hands' || key === 'face' || key === 'lightLevel')) {
      return 'offline'
    }
    if (key === 'camera') return feed.error ? 'offline' : feed.cameraReady ? 'tracking' : 'warning'
    if (key === 'hands') return feed.handsDetected ? 'tracking' : 'warning'
    if (key === 'face') return feed.faceDetected ? 'tracking' : 'warning'
    if (key === 'lightLevel') return feed.lightLevel
    return fallback
  }

  return (
    <Card>
      <h3 className="text-sm uppercase tracking-wide text-text-2 font-semibold mb-2.5">Detection status</h3>
      <div className="flex flex-col gap-2.5">
        {status &&
          rows.map(({ key, label }) => {
            const state = resolveState(key, status[key])
            return (
              <div key={key} className="flex items-center gap-2.5 text-xs font-medium">
                <StatusPill label={label} state={state} />
                <span className="ml-auto text-xs text-text-2 font-normal capitalize">{state}</span>
              </div>
            )
          })}
      </div>
    </Card>
  )
}
