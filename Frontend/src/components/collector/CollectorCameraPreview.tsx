import { AlertTriangle, Loader2, Play, Square, VideoOff } from 'lucide-react'
import { CameraFeedState } from '../../hooks/useCameraFeed'

interface CollectorCameraPreviewProps {
  feed: CameraFeedState
}

// A deliberately minimal sibling of live/CameraPanel.tsx, not a reuse of
// it - CameraPanel's status logic (Listening/Interpreting/Playing) is
// wired to speech + avatar state that doesn't exist here, and the
// requirement is to leave the live-conversation UI untouched rather than
// bend it to a second purpose. This shows the same video+skeleton overlay
// with just camera/hand/pose status, which is all the collector needs.
export default function CollectorCameraPreview({ feed }: CollectorCameraPreviewProps) {
  return (
    <div className="relative rounded-xl2 overflow-hidden bg-[#0F1B2B]" style={{ aspectRatio: '16 / 9' }}>
      <div className="absolute top-3 left-3 right-3 flex justify-between z-10">
        <button
          onClick={feed.toggleCamera}
          title={feed.enabled ? 'Stop camera' : 'Start camera'}
          className="bg-black/45 backdrop-blur-sm text-white text-sm font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-black/60 transition-colors"
        >
          {feed.enabled ? <Square size={11} /> : <Play size={11} />}
          {feed.enabled ? 'Stop camera' : 'Start camera'}
        </button>

        {feed.enabled && feed.cameraReady && (
          <div className="flex gap-1.5">
            <span
              className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                feed.handsDetected ? 'bg-success-light text-success-dark' : 'bg-white/10 text-white/60'
              }`}
            >
              Hands
            </span>
            <span
              className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                feed.poseDetected ? 'bg-success-light text-success-dark' : 'bg-white/10 text-white/60'
              }`}
            >
              Pose
            </span>
          </div>
        )}
      </div>

      {!feed.enabled ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/50 px-8 text-center">
          <VideoOff size={40} />
          <span className="text-sm">Click "Start camera" to begin.</span>
        </div>
      ) : feed.error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-white/60 px-8 text-center">
          <VideoOff size={40} />
          <span className="text-sm leading-relaxed max-w-xs">{feed.error}</span>
        </div>
      ) : (
        <>
          <video ref={feed.videoRef} muted playsInline className="absolute inset-0 w-full h-full" />
          <canvas ref={feed.canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
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
    </div>
  )
}
