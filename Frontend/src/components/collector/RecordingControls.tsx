import { Circle, Square, Timer, Trash2, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import Button from '../shared/Button'
import SecondsInput from '../shared/SecondsInput'

function LiveRecordingProgress({ getFrameCount }: { getFrameCount: () => number }) {
  const [frameCount, setFrameCount] = useState(0)
  const [fps, setFps] = useState<number | null>(null)
  useEffect(() => {
    let previousCount = getFrameCount()
    let previousTime = performance.now()
    setFrameCount(previousCount)
    const countTimer = window.setInterval(() => setFrameCount(getFrameCount()), 125)
    const fpsTimer = window.setInterval(() => {
      const now = performance.now()
      const count = getFrameCount()
      setFps((count - previousCount) * 1000 / (now - previousTime))
      previousCount = count
      previousTime = now
    }, 1000)
    return () => {
      window.clearInterval(countTimer)
      window.clearInterval(fpsTimer)
    }
  }, [getFrameCount])
  return <>Recording · {frameCount} frames · <span className="tabular-nums" title="Captured landmark frames per second, updated every second">{fps === null ? '—' : fps.toFixed(1)} FPS</span></>
}

interface RecordingControlsProps {
  stopLabel?: string
  recordingStatus?: ReactNode
  isRecording: boolean
  getRecordedFrameCount?: () => number
  canRecord: boolean
  countdown: number | null
  countdownSeconds: number
  onChangeCountdownSeconds: (seconds: number) => void
  durationLimitMs: number | undefined
  onChangeDurationLimitMs: (duration: number | undefined) => void
  onStart: () => void
  onCancelCountdown: () => void
  onStop: () => void
  onDiscard: () => void
}


export default function RecordingControls({
  stopLabel = 'Stop & save',
  recordingStatus,
  isRecording,
  getRecordedFrameCount,
  canRecord,
  countdown,
  countdownSeconds,
  onChangeCountdownSeconds,
  durationLimitMs,
  onChangeDurationLimitMs,
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

          <div className="flex w-full flex-col items-start gap-3">
          <div className="flex items-center gap-1.5 text-sm text-text-2" role="group" aria-label="Recording delay">
            <Timer size={14} />
            <span>Delay:</span>
            <SecondsInput label="Recording delay (seconds)" value={countdownSeconds} onChange={onChangeCountdownSeconds} />
            <span className="text-xs">seconds (0 = none)</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 text-sm text-text-2" role="group" aria-label="Sample duration">
            <Timer size={14} />
            <span>Duration:</span>
            <SecondsInput label="Sample duration (seconds)" value={(durationLimitMs ?? 0) / 1000} step={0.1}
              onChange={seconds => onChangeDurationLimitMs(seconds === 0 ? undefined : seconds * 1000)} />
            <span className="text-xs">seconds (0 = manual stop)</span>
          </div>
          </div>
        </>
      ) : (
        <>
          <Button variant="danger-solid" onClick={onStop}>
            <Square size={14} className="fill-current" /> {stopLabel}
          </Button>
          <Button variant="default" onClick={onDiscard}>
            <Trash2 size={14} /> Discard
          </Button>
          <span className="flex items-center gap-1.5 text-sm font-medium text-danger">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            {recordingStatus ?? (getRecordedFrameCount ? <LiveRecordingProgress getFrameCount={getRecordedFrameCount} /> : 'Recording')}
          </span>
        </>
      )}
    </div>
  )
}
