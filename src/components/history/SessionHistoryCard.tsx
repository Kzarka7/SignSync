import { Video, Play, Download, Trash2 } from 'lucide-react'
import { ConversationSession } from '../../types/session'
import Button from '../shared/Button'

export default function SessionHistoryCard({ session }: { session: ConversationSession }) {
  return (
    <div className="flex items-center gap-4 p-4 border border-border rounded-xl2 bg-white mb-2.5">
      <div className="w-13 h-13 rounded-[10px] bg-signal-light text-signal flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42 }}>
        <Video size={20} />
      </div>
      <div className="flex-1">
        <div className="text-md font-semibold">{session.title}</div>
        <div className="flex gap-4 text-sm text-text-2 mt-1">
          <span>{new Date(session.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          <span>{session.durationMinutes} min</span>
          <span>{session.messageCount} messages</span>
          <span>{session.avgConfidence}% avg. confidence</span>
        </div>
      </div>
      <div className="flex gap-2.5">
        <Button size="md" className="flex">
          <Play size={14} />
          <span className="text-xs">Replay</span>
        </Button>
        <Button size="md" title="Delete" variant="danger-solid">
          <Trash2 size={16} />
        </Button>
        <Button size="md" title="Export" variant="primary" className="font-bold">
          <Download size={16} />
        </Button>
      </div>
    </div>
  )
}
