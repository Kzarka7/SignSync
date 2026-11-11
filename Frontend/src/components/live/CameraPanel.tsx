import { AlertTriangle, Loader2, VideoOff } from 'lucide-react'
import CameraToolbar from '../shared/CameraToolbar'
import type { CameraFeedState } from '../../hooks/useCameraFeed'
import type { ReactNode } from 'react'

export default function CameraPanel({ feed, countdown = null, showHandsWarning = true, topRightContent }: {
  feed: CameraFeedState
  countdown?: number | null
  showHandsWarning?: boolean
  topRightContent?: ReactNode
}) {
  const handsWarning = showHandsWarning && feed.enabled && !feed.error && !feed.modelError && !feed.handsDetected
  const lightWarning = feed.enabled && !feed.error && !feed.modelError && feed.lightLevel === 'warning'

  return (
    <div>
      <div className="relative rounded-xl2 overflow-hidden bg-[#0F1B2B]" style={{ aspectRatio: '16 / 9' }}>
        <CameraToolbar feed={feed} topRightContent={topRightContent} />

        {!feed.enabled ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/50 px-8 text-center">
            <VideoOff size={40} />
            <span className="text-sm">Click "Start" to use camera detection.</span>
          </div>
        ) : feed.error ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-white/60 px-8 text-center">
            <VideoOff size={40} />
            <span className="text-sm leading-relaxed max-w-xs">{feed.error}</span>
          </div>
        ) : (
          <>
            <video ref={feed.videoRef} muted playsInline className="absolute inset-0 w-full h-full" />
            <canvas ref={feed.canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            <div className="absolute border-[1.5px] border-dashed border-white/35 rounded-2xl pointer-events-none" style={{ inset: '14%' }} />
            {!feed.cameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0F1B2B]/95 text-white/70">
                <Loader2 size={28} className="animate-spin" />
                <span className="text-sm">Starting camera...</span>
              </div>
            )}
          </>
        )}

        {countdown !== null && feed.enabled && feed.cameraReady && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 pointer-events-none" role="status" aria-live="polite" aria-atomic="true">
            <span className="sr-only">Recording starts in </span>
            <span className="text-white font-bold text-8xl drop-shadow-lg tabular-nums">{countdown}</span>
          </div>
        )}

        {feed.enabled && feed.cameraReady && (
          (handsWarning || lightWarning || feed.modelError) && (
            <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-1.5 z-10">
              {feed.modelError && (
                <div role="alert" className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-sm font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
                  <AlertTriangle size={14} />
                  {feed.modelError}
                </div>
              )}
              {handsWarning && (
                <div className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-sm font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
                  <AlertTriangle size={14} />
                  No hands detected — make sure your hands are visible in frame.
                </div>
              )}
              {lightWarning && (
                <div className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-sm font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
                  <AlertTriangle size={14} />
                  Lighting is a little low — move closer to a window for better accuracy.
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}
