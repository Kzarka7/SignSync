import { Video } from 'lucide-react'
import { useAsync } from '../../hooks/useAsync'
import { getRecentSessions } from '../../services/api/sessionsService'
import Badge from '../shared/Badge'
import Card from '../shared/Card'

export default function RecentSessions() {
  const { data: sessions, loading } = useAsync(() => getRecentSessions(3), [])

  return (
    <Card className="!p-1.5">
      {loading && <div className="p-4 text-sm text-text-2">Loading sessions...</div>}
      {sessions?.map((s) => (
        <div key={s.id} className="flex items-center gap-3.5 px-3 py-3 border-b border-border last:border-none">
          <div className="w-9 h-9 rounded-[10px] bg-signal-light text-signal flex items-center justify-center flex-shrink-0">
            <Video size={16} />
          </div>
          <div>
            <div className="text-[13.5px] font-semibold">{s.title}</div>
            <div className="text-xs text-text-2 mt-0.5">
              {new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
              {s.durationMinutes} min · {s.messageCount} messages
            </div>
          </div>
          <div className="flex-1" />
          <Badge tone={s.avgConfidence >= 90 ? 'ok' : 'med'}>{s.avgConfidence}% confidence</Badge>
        </div>
      ))}
    </Card>
  )
}
