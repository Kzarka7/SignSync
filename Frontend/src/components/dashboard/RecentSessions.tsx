import { useMemo, useState } from 'react'
import { Video } from 'lucide-react'
import { useAsync } from '../../hooks/useAsync'
import { getRecentSessions } from '../../services/api/sessionsService'
import { getSessions as getStoredSessions } from '../../services/sessionHistoryStorage'
import { ConversationSession, SavedSession } from '../../types/session'
import { ConversationType } from '../../types/conversation'
import Badge from '../shared/Badge'
import Card from '../shared/Card'

const RECENT_SESSIONS_LIMIT = 3

// Same mapping HistoryPage uses to fold a real saved session's
// conversation type onto the (mock) demo sessions' location-style label.
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
  // Pull enough mock sessions that, even after merging with real ones and
  // trimming to the display limit, the dashboard still has demo data to
  // fall back on for a brand-new user.
  const { data: mockSessions, loading } = useAsync(() => getRecentSessions(RECENT_SESSIONS_LIMIT), [])

  // Read once on mount - this component remounts whenever the dashboard is
  // navigated to, so it always reflects the latest session saved from a
  // live conversation.
  const [storedSessions] = useState<SavedSession[]>(() => getStoredSessions())

  const sessions = useMemo(() => {
    const real = storedSessions.map(toConversationSession)
    const mock = mockSessions ?? []
    return [...real, ...mock]
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, RECENT_SESSIONS_LIMIT)
  }, [storedSessions, mockSessions])

  return (
    <Card className="!p-5">
      {loading && <div className="p-4 text-sm text-text-2">Loading sessions...</div>}
      <span className="text-md font-semibold text-text-2 uppercase tracking-wide mb-3">Recent sessions</span>
      {!loading && sessions.length === 0 && (
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
