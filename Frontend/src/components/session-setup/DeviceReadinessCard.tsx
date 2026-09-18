import { Volume2, Video, Mic } from 'lucide-react'
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
    <Card className="border-border p-4 shadow-sm sm:p-5">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-ink">Device readiness</h2>
        <p className="mt-1 text-base text-text-2">Check these before starting your conversation.</p>
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-4" aria-live="polite" aria-atomic="false">
        <div className="flex min-h-12 items-center rounded-lg py-1.5 px-2 even:bg-sky gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EFF3F7] text-trust" aria-hidden="true"><Video size={20} /></span>
          <span className="text-dm font-bold tracking-wide">Camera</span>
          <span className="ml-auto text-base font-bold text-text-2">{readableLabel(readiness.camera)}</span>
        </div>
        <div className="flex min-h-12 items-center rounded-lg py-1.5 px-2 even:bg-sky gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EFF3F7] text-trust" aria-hidden="true"><Mic size={20} /></span>
          <span className="text-md font-bold tracking-wide">Microphone</span>
          <span className="ml-auto text-base font-bold text-text-2">{readableLabel(readiness.microphone)}</span>
        </div>
        <div className="flex min-h-12 items-center rounded-lg py-1.5 px-2 even:bg-sky gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EFF3F7] text-trust" aria-hidden="true"><Volume2 size={20} /></span>
          <span className="text-md font-bold tracking-wide">Speaker</span>
          <span className="ml-auto text-base font-bold text-text-2">{readableLabel(readiness.speaker)}</span>
        </div>
      </div>
      <Button size="sm" className="mt-4 min-h-11 w-full justify-center text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]" onClick={readiness.testSpeaker}>
        Test speaker
      </Button>
    </Card>
  )
}
