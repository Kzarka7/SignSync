import { AlertTriangle, VideoOff } from 'lucide-react'
import { CameraFeedState } from '../../hooks/useCameraFeed'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import StatusPill from '../shared/StatusPill'

interface CameraPanelProps {
  feed: CameraFeedState
}

// Renders the live camera feed with a hand-landmark overlay drawn by
// useCameraFeed. Face/microphone/speaker/AI status still come from the
// mocked/REST device snapshot (useDeviceStatus) - only hands + light are
// real in this phase.
export default function CameraPanel({ feed }: CameraPanelProps) {
  const status = useDeviceStatus()

  return (
    <div>
      <div className="relative rounded-xl2 overflow-hidden bg-[#0F1B2B]" style={{ aspectRatio: '16 / 9' }}>
        <div className="absolute top-3 left-3 right-3 flex justify-between z-10">
          <div className="bg-black/45 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-danger" />
            Live
          </div>
          <div className="bg-black/45 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg">
            {feed.handsDetected ? 'Signer detected' : 'No hands detected'}
          </div>
        </div>

        {feed.error ? (
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

        {feed.lightLevel === 'warning' && !feed.error && (
          <div className="absolute bottom-3 left-3 right-3 bg-amber/15 border border-amber/50 text-[#FDD98A] text-[11.5px] font-medium px-2.5 py-2 rounded-lg flex items-center gap-2 z-10">
            <AlertTriangle size={14} />
            Lighting is a little low — move closer to a window for better accuracy.
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-3 flex-wrap">
        <StatusPill label="Hands" state={feed.handsDetected ? 'tracking' : 'warning'} />
        {status && <StatusPill label="Face" state={status.face} />}
        <StatusPill label="Light" state={feed.lightLevel} />
      </div>
    </div>
  )
}
