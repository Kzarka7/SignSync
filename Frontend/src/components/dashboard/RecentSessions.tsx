import { useMemo, useState } from 'react'
import { Video } from 'lucide-react'
import { getSessions as getStoredSessions } from '../../services/sessionHistoryStorage'
import { ConversationSession, SavedSession } from '../../types/session'
import { ConversationType } from '../../types/conversation'
import Badge from '../shared/Badge'
import Card from '../shared/Card'

const RECENT_SESSIONS_LIMIT = 3

// Same mapping HistoryPage uses to fold a real saved session's
// conversation type onto a location-style label.
const CONVERSATION_TYPE_TO_LOCATION: Record<ConversationType, string> = {
  medical: 'Hospital',
  school: 'School',
  government: 'Government office',
  other: 'Other',
}

function toConversationSession(saved: SavedSession): ConversationSession {
  return {
    id: saved.id,
    title: saved.sessionName,
    location: CONVERSATION_TYPE_TO_LOCATION[saved.conversationType] ?? 'Other',
    startedAt: saved.startedAt,
    durationMinutes: Math.max(0, Math.round(saved.durationSeconds / 60)),
    messageCount: saved.messages.length,
    avgConfidence: saved.avgConfidence ?? undefined,
  }
}

export default function RecentSessions() {
  // Read once on mount - this component remounts whenever the dashboard is
  // navigated to, so it always reflects the latest session saved from a
  // live conversation. Real recorded sessions only - no seeded demo data.
  const [storedSessions] = useState<SavedSession[]>(() => getStoredSessions())

  const sessions = useMemo(() => {
    return storedSessions
      .map(toConversationSession)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, RECENT_SESSIONS_LIMIT)
  }, [storedSessions])

  return (
    <Card className="!p-5">
      <span className="text-md font-semibold text-text-2 uppercase tracking-wide mb-3">Recent sessions</span>
      {sessions.length === 0 && (
        <div className="py-4 text-sm text-text-2">No sessions yet - start a live conversation to see it here.</div>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3.5 py-3 border-b border-border last:border-none">
          <div className="rounded-[10px] bg-signal-light text-signal flex items-center justify-center flex-shrink-0" style={{ width: 42, height: 42 }}>
            <Video size={20} />
          </div>
          <div>
            <div className="text-md font-bold">{s.title}</div>
            <div className="text-sm text-text-2 mt-0.5">
              {new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
              {s.durationMinutes} min · {s.messageCount} messages
            </div>
          </div>
          <div className="flex-1" />
          {s.avgConfidence !== undefined ? (
            <Badge tone={s.avgConfidence >= 90 ? 'ok' : 'med'}>{s.avgConfidence}% confidence</Badge>
          ) : (
            <span className="text-sm text-text-3">No confidence data</span>
          )}
        </div>
      ))}
    </Card>
  )
}
