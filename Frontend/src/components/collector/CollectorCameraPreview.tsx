import { AlertTriangle, Loader2, VideoOff } from 'lucide-react'
import type { CameraFeedState } from '../../hooks/useCameraFeed'
import CameraToolbar, { type CameraToolbarFeed } from '../shared/CameraToolbar'

interface CollectorCameraPreviewProps {
  feed: CameraToolbarFeed & Pick<CameraFeedState, 'videoRef' | 'canvasRef'>
  countdown?: number | null
  showTrackingStatus?: boolean
  cameraToggleDisabled?: boolean
}

export default function CollectorCameraPreview({ feed, countdown = null, showTrackingStatus = true, cameraToggleDisabled = false }: CollectorCameraPreviewProps) {
  return (
    <div className="relative rounded-xl2 overflow-hidden bg-[#0F1B2B]" style={{ aspectRatio: '16 / 9' }}>
      <CameraToolbar feed={feed} cameraToggleDisabled={cameraToggleDisabled} />

      {!feed.enabled ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/50 px-8 text-center">
          <VideoOff size={40} />
          <span className="text-sm">Click "Start" to begin.</span>
        </div>
      ) : feed.error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-white/60 px-8 text-center">
          <VideoOff size={40} />
          <span className="text-sm leading-relaxed max-w-xs">{feed.error}</span>
        </div>
      ) : (
        <>
          <video ref={feed.videoRef} muted playsInline className="absolute inset-0 w-full h-full" />
          {showTrackingStatus && <canvas ref={feed.canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />}
          {!feed.cameraReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0F1B2B]/95 text-white/70">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">Starting camera...</span>
            </div>
          )}
        </>
      )}

      {feed.enabled && feed.cameraReady && feed.modelError && (
        <div className="absolute bottom-3 left-3 right-3 z-10">
          <div className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-sm font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
            <AlertTriangle size={14} />
            {feed.modelError}
          </div>
        </div>
      )}

      {/* Big, hard-to-miss countdown - this is what you're actually
          watching while getting both hands into position, not the small
          text in the controls panel below. Detection keeps running
          underneath the whole time; this is purely visual. */}
      {countdown !== null && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40">
          <span className="text-white font-bold text-8xl drop-shadow-lg tabular-nums">
            {countdown}
          </span>
        </div>
      )}
    </div>
  )
}
