import { Circle, Square, Trash2 } from 'lucide-react'
import Button from '../shared/Button'

interface RecordingControlsProps {
  isRecording: boolean
  frameCount: number
  canRecord: boolean
  onStart: () => void
  onStop: () => void
  onDiscard: () => void
}

export default function RecordingControls({
  isRecording,
  frameCount,
  canRecord,
  onStart,
  onStop,
  onDiscard,
}: RecordingControlsProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      {!isRecording ? (
        <Button variant="primary" onClick={onStart} disabled={!canRecord}>
          <Circle size={14} className="fill-current" /> Start recording
        </Button>
      ) : (
        <>
          <Button variant="danger-solid" onClick={onStop}>
            <Square size={14} className="fill-current" /> Stop &amp; save
          </Button>
          <Button variant="default" onClick={onDiscard}>
            <Trash2 size={14} /> Discard
          </Button>
        </>
      )}

      {isRecording && (
        <span className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
          Recording · {frameCount} frames
        </span>
      )}
    </div>
  )
}
