import { Volume2 } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'
import StatusPill from '../shared/StatusPill'
import type { DeviceReadiness } from '../../hooks/useDeviceReadiness'
import type { DeviceState } from '../../types/device'

interface DeviceReadinessCardProps {
  readiness: DeviceReadiness
}

// Maps the readiness hook's own vocabulary (checking/idle, not used
// elsewhere in the app) onto the existing StatusPill's DeviceState, so
// this reuses the same pulse-ring visual language as the rest of the app
// rather than inventing a new indicator style.
function toPillState(state: string): DeviceState {
  if (state === 'ready') return 'ready'
  if (state === 'warning') return 'warning'
  if (state === 'checking') return 'warning'
  return 'offline' // 'error' or 'idle' (speaker, untested)
}

function readableLabel(state: string): string {
  switch (state) {
    case 'ready':
      return 'Ready'
    case 'checking':
      return 'Checking...'
    case 'warning':
      return 'Limited'
    case 'error':
      return 'Not available'
    case 'idle':
      return 'Not tested'
    default:
      return state
  }
}

export default function DeviceReadinessCard({ readiness }: DeviceReadinessCardProps) {
  return (
    <Card>
      <h3 className="text-sm uppercase tracking-wide text-text-2 font-semibold mb-3">Device readiness</h3>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <StatusPill label="Camera" state={toPillState(readiness.camera)} />
          <span className="text-xs text-text-2 ml-auto">{readableLabel(readiness.camera)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <StatusPill label="Microphone" state={toPillState(readiness.microphone)} />
          <span className="text-xs text-text-2 ml-auto">{readableLabel(readiness.microphone)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <StatusPill label="Speaker" state={toPillState(readiness.speaker)} />
          <span className="text-xs text-text-2 ml-auto">{readableLabel(readiness.speaker)}</span>
        </div>
      </div>
      <Button size="sm" className="mt-3.5 w-full justify-center" onClick={readiness.testSpeaker}>
        <Volume2 size={14} />
        Test speaker
      </Button>
    </Card>
  )
}
