import { ArrowRight, CheckCircle2 } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'

interface SessionReadyCardProps {
  devicesBlocked: boolean
  devicesChecking: boolean
  onBegin: () => void
  onRecheckDevices: () => void
}

export default function SessionReadyCard({
  devicesBlocked,
  devicesChecking,
  onBegin,
  onRecheckDevices,
}: SessionReadyCardProps) {
  return (
    <Card className="border-border p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${devicesBlocked ? 'bg-danger-light text-danger' : devicesChecking ? 'bg-amber-light text-amber-dark' : 'bg-success-light text-success-dark'}`} aria-hidden="true"><CheckCircle2 size={21} /></span>
        <div>
          <h2 className="text-xl font-bold text-ink">Ready to begin?</h2>
          <p className="mt-1 text-base leading-relaxed text-text-2">
        {devicesBlocked
          ? 'Camera and microphone access are required to begin a conversation. Please allow access and try again.'
          : devicesChecking
          ? 'We’re checking your camera and microphone. This only takes a moment.'
          : 'Once you begin, the camera starts watching for signs automatically. Speech recognition starts when you tap the microphone.'}
          </p>
        </div>
      </div>
      <Button
        variant="primary"
        className="min-h-13 w-full justify-center text-lg focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={devicesBlocked || devicesChecking}
        onClick={onBegin}
      >
        Begin conversation
        <ArrowRight size={20} />
      </Button>
      {devicesBlocked && (
        <button
          onClick={onRecheckDevices}
          className="mt-3 min-h-11 w-full rounded-lg text-base font-bold text-signal hover:bg-signal-light focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]"
        >
          Recheck devices
        </button>
      )}
    </Card>
  )
}
