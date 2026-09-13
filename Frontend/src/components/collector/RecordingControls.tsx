import { Circle, Square, Timer, Trash2, X } from 'lucide-react'
import Button from '../shared/Button'

interface RecordingControlsProps {
  isRecording: boolean
  frameCount: number
  canRecord: boolean
  countdown: number | null
  countdownSeconds: number
  onChangeCountdownSeconds: (seconds: number) => void
  onStart: () => void
  onCancelCountdown: () => void
  onStop: () => void
  onDiscard: () => void
}

const COUNTDOWN_OPTIONS = [1, 3, 5]

export default function RecordingControls({
  isRecording,
  frameCount,
  canRecord,
  countdown,
  countdownSeconds,
  onChangeCountdownSeconds,
  onStart,
  onCancelCountdown,
  onStop,
  onDiscard,
}: RecordingControlsProps) {
  const isCountingDown = countdown !== null

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {isCountingDown ? (
        <>
          <Button variant="default" onClick={onCancelCountdown}>
            <X size={14} /> Cancel
          </Button>
          <span className="flex items-center gap-1.5 text-sm font-medium text-text-2">
            Get ready · starting in {countdown}...
          </span>
        </>
      ) : !isRecording ? (
        <>
          <Button variant="primary" onClick={onStart} disabled={!canRecord}>
            <Circle size={14} className="fill-current" /> Start recording
          </Button>

          <span className="text-xs text-text-2">
            <kbd className="px-1 py-0.5 rounded border border-border bg-sky font-mono">Space</kbd> start/stop ·{' '}
            <kbd className="px-1 py-0.5 rounded border border-border bg-sky font-mono">Esc</kbd> discard
          </span>

          <div className="flex items-center gap-1.5 text-sm text-text-2">
            <Timer size={14} />
            <span>Delay:</span>
            <div className="flex gap-1">
              {COUNTDOWN_OPTIONS.map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => onChangeCountdownSeconds(seconds)}
                  className={`px-2 py-0.5 rounded-md text-xs font-medium border transition-colors ${
                    countdownSeconds === seconds
                      ? 'bg-signal text-white border-signal'
                      : 'bg-white text-text-2 border-border hover:border-signal'
                  }`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <Button variant="danger-solid" onClick={onStop}>
            <Square size={14} className="fill-current" /> Stop &amp; save
          </Button>
          <Button variant="default" onClick={onDiscard}>
            <Trash2 size={14} /> Discard
          </Button>
          <span className="flex items-center gap-1.5 text-sm font-medium text-danger">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            Recording · {frameCount} frames
          </span>
        </>
      )}
    </div>
  )
}
