import { useEffect } from 'react'
import { Maximize, Download } from 'lucide-react'
import Button from '../shared/Button'
import StatusPill from '../shared/StatusPill'
import { useSessionStore } from '../../store/sessionStore'

function formatTime(totalSeconds: number) {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

export default function LiveTopbar({ onEnd, onExport }: { onEnd: () => void; onExport: () => void }) {
  const { elapsedSeconds, tick } = useSessionStore()

  useEffect(() => {
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [tick])

  return (
    <div className="flex items-center justify-between bg-white border border-border rounded-xl2 px-4.5 py-3 mb-4" style={{ padding: '12px 18px' }}>
      <div className="flex items-center gap-4">
        <span className="text-md font-bold text-text-1 uppercase tracking-wide self-center mr-0.5 whitespace-nowrap">Medical</span>
        <div className="text-text-2">
          <StatusPill label="Auto-detecting · signing now" state="ready" />
        </div>
        <span className="font-mono text-sm text-text-3">{formatTime(elapsedSeconds)}</span>
      </div>
      <div className="flex gap-2">
        <Button size="sm" title="Fullscreen">
          <Maximize size={14} />
        </Button>
        <Button size="sm" onClick={onExport}>
          <Download size={14} />
          Export
        </Button>
        <Button size="sm" variant="danger" onClick={onEnd}>
          End session
        </Button>
      </div>
    </div>
  )
}
