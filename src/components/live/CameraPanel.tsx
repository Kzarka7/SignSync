import { AlertTriangle, Play, Square, VideoOff } from 'lucide-react'
import { CameraFeedState } from '../../hooks/useCameraFeed'
import StatusPill from '../shared/StatusPill'

interface CameraPanelProps {
  feed: CameraFeedState
}

// Renders the live camera feed with a hand-landmark overlay drawn by
// useCameraFeed. Hands, face, and light are all real detection now;
// microphone/speaker/AI status still come from the mocked/REST device
// snapshot (see DetectionStatusPanel).
export default function CameraPanel({ feed }: CameraPanelProps) {
  const handsWarning = feed.enabled && !feed.error && !feed.handsDetected
  const faceWarning = feed.enabled && !feed.error && !feed.faceDetected
  const lightWarning = feed.enabled && !feed.error && feed.lightLevel === 'warning'

  return (
    <div>
      <div className="relative rounded-xl2 overflow-hidden bg-[#0F1B2B]" style={{ aspectRatio: '16 / 9' }}>
        <div className="absolute top-3 left-3 right-3 flex justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="bg-black/45 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${feed.enabled ? 'bg-danger' : 'bg-text-3'}`} />
              {feed.enabled ? 'Live' : 'Paused'}
            </div>
            <button
              onClick={feed.toggleCamera}
              title={feed.enabled ? 'Stop camera' : 'Start camera'}
              className="bg-black/45 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-black/60 transition-colors"
            >
              {feed.enabled ? <Square size={11} /> : <Play size={11} />}
              {feed.enabled ? 'Stop' : 'Start'}
            </button>
          </div>
          <div className="bg-black/45 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg">
            {!feed.enabled ? 'Camera off' : feed.handsDetected ? 'Signer detected' : 'No hands detected'}
          </div>
        </div>

        {!feed.enabled ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/50 px-8 text-center">
            <VideoOff size={32} />
            <span className="text-xs">Camera is paused. Click "Start" to resume detection.</span>
          </div>
        ) : feed.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-white/60 px-8 text-center">
            <VideoOff size={32} />
            <span className="text-xs leading-relaxed max-w-xs">{feed.error}</span>
          </div>
        ) : (
          <>
            <video ref={feed.videoRef} muted playsInline className="absolute inset-0 w-full h-full object-cover" />
            <canvas ref={feed.canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            <div className="absolute border-[1.5px] border-dashed border-white/35 rounded-2xl pointer-events-none" style={{ inset: '14%' }} />
          </>
        )}

        {(handsWarning || faceWarning || lightWarning) && (
          <div className="absolute bottom-3 left-3 right-3 flex flex-col gap-1.5 z-10">
            {handsWarning && (
              <div className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-[11.5px] font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} />
                No hands detected — make sure your hands are visible in frame.
              </div>
            )}
            {faceWarning && (
              <div className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-[11.5px] font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} />
                Face not clearly detected — face the camera directly.
              </div>
            )}
            {lightWarning && (
              <div className="bg-amber/15 border border-amber/50 text-[#FDD98A] text-[11.5px] font-medium px-2.5 py-2 rounded-lg flex items-center gap-2">
                <AlertTriangle size={14} />
                Lighting is a little low — move closer to a window for better accuracy.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3 flex-wrap">
        <StatusPill label="Hands" state={!feed.enabled ? 'offline' : feed.handsDetected ? 'tracking' : 'warning'} />
        <StatusPill label="Face" state={!feed.enabled ? 'offline' : feed.faceDetected ? 'tracking' : 'warning'} />
        <StatusPill label="Light" state={!feed.enabled ? 'offline' : feed.lightLevel} />
      </div>
    </div>
  )
}
