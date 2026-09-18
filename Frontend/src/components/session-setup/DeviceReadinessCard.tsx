import { Volume2, Video, Mic } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'
import type { DeviceReadiness } from '../../hooks/useDeviceReadiness'

interface DeviceReadinessCardProps {
  readiness: DeviceReadiness
}

// Maps the readiness hook's own vocabulary (checking/warning/error/idle)
// down to the three states the status dot actually distinguishes:
// ready (green), checking (orange), and not tested (no color). 'warning'
// reads as still-in-progress rather than failed, so it shares checking's
// orange; 'error' collapses into the same neutral/no-color treatment as
// 'idle' - the label text next to it still says "Not available", the dot
// just isn't used to separate that from "never checked".
type DotState = 'ready' | 'checking' | 'none'

function toDotState(state: string): DotState {
  if (state === 'ready') return 'ready'
  if (state === 'checking' || state === 'warning') return 'checking'
  return 'none' // 'error' or 'idle' (speaker, untested)
}

const dotColor: Record<DotState, string> = {
  ready: 'bg-success',
  checking: 'bg-amber',
  none: '', // no color - the placeholder span below stays transparent
}

// Small colored status dot: green for ready, orange for checking, and
// genuinely no color (a transparent placeholder, not a gray dot) for
// not-tested/error, so only an actual result draws the eye.
function StatusDot({ state }: { state: string }) {
  const dot = toDotState(state)
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${dotColor[dot]}`}
      aria-hidden="true"
    />
  )
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
          <span className="ml-auto flex items-center gap-2 text-base font-semibold text-ink">
            <StatusDot state={readiness.camera} />
            {readableLabel(readiness.camera)}
          </span>
        </div>
        <div className="flex min-h-12 items-center rounded-lg py-1.5 px-2 even:bg-sky gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EFF3F7] text-trust" aria-hidden="true"><Mic size={20} /></span>
          <span className="text-md font-bold tracking-wide">Microphone</span>
          <span className="ml-auto flex items-center gap-2 text-base font-semibold text-ink">
            <StatusDot state={readiness.microphone} />
            {readableLabel(readiness.microphone)}
          </span>
        </div>
        <div className="flex min-h-12 items-center rounded-lg py-1.5 px-2 even:bg-sky gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#EFF3F7] text-trust" aria-hidden="true"><Volume2 size={20} /></span>
          <span className="text-md font-bold tracking-wide">Speaker</span>
          <span className="ml-auto flex items-center gap-2 text-base font-semibold text-ink">
            <StatusDot state={readiness.speaker} />
            {readableLabel(readiness.speaker)}
          </span>
        </div>
      </div>
      <Button size="sm" className="mt-4 min-h-11 w-full justify-center text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]" onClick={readiness.testSpeaker}>
        Test speaker
      </Button>
    </Card>
  )
}