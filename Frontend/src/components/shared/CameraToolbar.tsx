import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CameraFeedState, LiveCameraTiming } from '../../hooks/useCameraFeed'

const cameraControlClass = 'inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-black/70 px-2.5 text-sm font-semibold text-white'

export type CameraToolbarFeed = Pick<CameraFeedState, 'enabled' | 'cameraReady' | 'error' | 'modelError' | 'toggleCamera'>
  & Partial<Pick<CameraFeedState, 'getLiveTiming'>>

export default function CameraToolbar({ feed, cameraToggleDisabled = false }: {
  feed: CameraToolbarFeed
  cameraToggleDisabled?: boolean
}) {
  const [timing, setTiming] = useState<LiveCameraTiming | null>(null)
  const readTiming = feed.getLiveTiming
  const active = feed.enabled && feed.cameraReady && !feed.error && !feed.modelError

  useEffect(() => {
    if (!active || !readTiming) {
      setTiming(null)
      return
    }
    const refresh = () => setTiming(readTiming())
    refresh()
    const timer = setInterval(refresh, 250)
    return () => clearInterval(timer)
  }, [active, readTiming])

  const live = active ? timing : null
  const handCount = live?.latest.handCount ?? 0
  const delegates = [live?.handDelegate, live?.poseDelegate].filter(Boolean)
  const delegate = delegates.every(value => value === delegates[0]) ? delegates[0] : delegates.join(' + ')
  const state = feed.error || feed.modelError ? 'Error' : feed.enabled ? 'Starting…' : 'Paused'

  return (
    <div className="absolute inset-x-3 top-3 z-10 flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={feed.toggleCamera} disabled={cameraToggleDisabled} aria-label={feed.enabled ? 'Stop camera' : 'Start camera'}
          className={`${cameraControlClass} hover:bg-black/90 disabled:opacity-50`}>
          {feed.enabled ? <Square aria-hidden="true" size={12} /> : <Play aria-hidden="true" size={12} />}
          {feed.enabled ? 'Stop' : 'Start'}
        </button>
        {live ? (
          <span className={cameraControlClass}
            title="Latest hands and pose inference time, processed FPS, and inference delegate">
            <span aria-hidden="true" className="size-2 rounded-full bg-success" />
            Live ML
            <span className="border-l border-white/30 pl-1.5 text-xs font-normal tabular-nums">
              {Math.round(live.latest.handMs + live.latest.poseMs)} ms
              {' · '}{live.processedFps?.toFixed(1) ?? '—'} FPS
              {delegate ? ` · ${delegate}` : ''}
            </span>
          </span>
        ) : (
          readTiming && <span className={cameraControlClass}>{state}</span>
        )}
      </div>
      {live && handCount > 0 && (
        <span className={`ml-auto ${cameraControlClass}`}>
          {handCount} {handCount === 1 ? 'hand' : 'hands'}
          {handCount === 1 && live.latest.singleHandSide && ` · ${live.latest.singleHandSide}`}
        </span>
      )}
    </div>
  )
}
