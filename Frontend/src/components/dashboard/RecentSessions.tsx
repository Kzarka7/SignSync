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
    <Card className="border-border p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">Recent sessions</h2>
        {sessions.length > 0 && <span className="text-sm font-semibold text-text-2">Latest {sessions.length}</span>}
      </div>
      {sessions.length === 0 && (
        <div className="rounded-lg bg-sky px-4 py-5 text-base leading-relaxed text-text-2">No sessions yet. Start a live conversation to see it here.</div>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center gap-3 border-b border-border py-4 last:border-none">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-signal-light text-signal">
            <Video size={20} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-ink">{s.title}</div>
            <div className="mt-0.5 text-sm leading-relaxed text-text-2">
              {new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ·{' '}
              {s.durationMinutes} min · {s.messageCount} messages
            </div>
          </div>
          <div className="flex-1" />
          {s.avgConfidence !== undefined ? (
            <Badge tone={s.avgConfidence >= 90 ? 'ok' : 'med'}>{s.avgConfidence}% confidence</Badge>
          ) : (
            <span className="text-right text-sm font-medium text-text-3">No score</span>
          )}
        </div>
      ))}
    </Card>
  )
}
