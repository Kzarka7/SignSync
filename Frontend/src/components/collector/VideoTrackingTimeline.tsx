import { memo, useMemo } from 'react'
import type { DatasetFrame } from '../../types/dataset'
import { videoDiagnostics } from '../../services/dataset/videoDiagnostics'
import { frameSpan, medianFrameStep } from '../../services/dataset/frameTiming'

function VideoTrackingTimeline({ frames, start, end, selectedStart = start, selectedEnd = end, onSeek }: {
  frames: DatasetFrame[]; start: number; end: number; selectedStart?: number; selectedEnd?: number; onSeek: (seconds: number) => void
}) {
  const ticks = useMemo(() => videoDiagnostics(frames), [frames])
  const step = useMemo(() => medianFrameStep(frames), [frames])
  const rows = [
    { name: 'Left hand', key: 'left' as const, color: '#22c55e' },
    { name: 'Right hand', key: 'right' as const, color: '#38bdf8' },
    { name: 'Shoulders', key: 'shoulders' as const, color: '#a78bfa' },
    { name: 'Movement', key: 'moving' as const, color: '#2d7fff' },
    { name: 'Near edge', key: 'clipped' as const, color: '#f59e0b' },
  ]
  const duration = Math.max(.05, end - start)
  const x = (time: number) => Math.max(0, Math.min(1000, (time - start) / duration * 1000))
  return <div className="space-y-2">
    <p className="text-sm font-semibold">Tracking timeline · {start.toFixed(2)}–{end.toFixed(2)}s</p>
    <div className="flex gap-2 items-center"><span className="text-xs w-20 shrink-0">Selection</span>
      <svg role="img" aria-label={`Selected interval ${selectedStart.toFixed(2)} to ${selectedEnd.toFixed(2)} seconds`} viewBox="0 0 1000 18" preserveAspectRatio="none" className="h-5 flex-1 rounded bg-border">
        <rect x={x(selectedStart)} y="0" width={Math.max(0, x(selectedEnd) - x(selectedStart))} height="18" fill="#2d7fff" fillOpacity="0.25" />
        <line x1={x(selectedStart)} x2={x(selectedStart)} y1="0" y2="18" stroke="#2d7fff" strokeWidth="5" />
        <line x1={x(selectedEnd)} x2={x(selectedEnd)} y1="0" y2="18" stroke="#2d7fff" strokeWidth="5" />
      </svg>
    </div>
    <p className="text-xs text-text-2">Selected start {selectedStart.toFixed(2)}s · end {selectedEnd.toFixed(2)}s</p>
    <div className="space-y-1">{rows.map(row => <div key={row.key} className="flex gap-2 items-center">
      <span className="text-xs w-20 shrink-0">{row.name}</span>
      <svg role="img" aria-label={`${row.name} detections; blank areas mean no detection`} viewBox="0 0 1000 12" preserveAspectRatio="none" className="h-3 flex-1 rounded bg-border">
        <title>{row.name}: colored periods show detected activity; blank periods do not establish rest.</title>
        {ticks.map((tick, index) => tick[row.key] ? <rect key={tick.timestamp} x={tick.timestamp / (duration * 1000) * 1000} y="0" width={Math.min(step * 1.5, frameSpan(frames, index, step, duration * 1000)) / (duration * 1000) * 1000 + .1} height="12" fill={row.color} /> : null)}
      </svg>
    </div>)}</div>
    <label className="block text-xs">Seek within processed interval
      <input className="block w-full accent-signal" aria-label="Seek tracking timeline" type="range" min={start} max={Math.max(start, end - .001)} step="0.05" defaultValue={start} onChange={event => onSeek(event.target.valueAsNumber)} />
    </label>

  </div>
}
export default memo(VideoTrackingTimeline)
