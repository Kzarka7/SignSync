import { Video, Play, Download } from 'lucide-react'
import { ConversationSession } from '../../types/session'
import Button from '../shared/Button'

export default function SessionHistoryCard({ session }: { session: ConversationSession }) {
  return (
    <div className="flex items-center gap-4 p-4 border border-border rounded-xl2 bg-white mb-2.5">
      <div className="w-13 h-13 rounded-[10px] bg-signal-light text-signal flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42 }}>
        <Video size={20} />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold">{session.title}</div>
        <div className="flex gap-4 text-xs text-text-2 mt-1">
          <span>{new Date(session.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          <span>{session.durationMinutes} min</span>
          <span>{session.messageCount} messages</span>
          <span>{session.avgConfidence}% avg. confidence</span>
        </div>
      </div>
      <Button size="sm" className="text-[14px]">
        <Play size={13} />
        Replay
      </Button>
      <Button size="md" title="Export">
        <Download size={13} />
      </Button>
    </div>
  )
}
