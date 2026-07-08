import { AlertTriangle } from 'lucide-react'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import StatusPill from '../shared/StatusPill'

export default function CameraPanel() {
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
            Signer detected
          </div>
        </div>

        <div className="absolute border-[1.5px] border-dashed border-white/35 rounded-2xl" style={{ inset: '14%' }} />

        <div className="absolute inset-0 flex items-center justify-center text-white/25">
          {/* Placeholder for the live <video> element the camera feed will render into */}
          <svg width="90" height="120" viewBox="0 0 90 120" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="45" cy="20" r="14" />
            <path d="M45 34v46M20 55l25-10 25 10M25 100l20-20 20 20" />
          </svg>
        </div>

        {status?.lightLevel === 'warning' && (
          <div className="absolute bottom-3 left-3 right-3 bg-amber/15 border border-amber/50 text-[#FDD98A] text-[11.5px] font-medium px-2.5 py-2 rounded-lg flex items-center gap-2 z-10">
            <AlertTriangle size={14} />
            Lighting is a little low — move closer to a window for better accuracy.
          </div>
        )}
      </div>
    </div>
  )
}
