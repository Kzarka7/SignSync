import { useMemo, useState } from 'react'
import { Activity, CalendarDays, Target } from 'lucide-react'
import { getSessions } from '../../services/sessionHistoryStorage'
import { SavedSession } from '../../types/session'

function isInCurrentWeek(isoDate: string, now: Date): boolean {
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return false

  const weekStart = new Date(now)
  const daysSinceMonday = (now.getDay() + 6) % 7
  weekStart.setHours(0, 0, 0, 0)
  weekStart.setDate(now.getDate() - daysSinceMonday)

  const nextWeekStart = new Date(weekStart)
  nextWeekStart.setDate(weekStart.getDate() + 7)
  return date >= weekStart && date < nextWeekStart
}

export default function MetricGrid() {
  // Read persisted history once when the dashboard mounts, matching the
  // Recent Sessions panel. The dashboard remounts after a completed live
  // conversation, so these values reflect the newly saved session.
  const [sessions] = useState<SavedSession[]>(() => getSessions())
  const { sessionsThisWeek, averageConfidence, scoredSessionCount } = useMemo(() => {
    const now = new Date()
    const scoredSessions = sessions.filter((session) => session.avgConfidence !== null)
    return {
      sessionsThisWeek: sessions.filter((session) => isInCurrentWeek(session.startedAt, now)).length,
      averageConfidence:
        scoredSessions.length > 0
          ? Math.round(scoredSessions.reduce((total, session) => total + (session.avgConfidence ?? 0), 0) / scoredSessions.length)
          : null,
      scoredSessionCount: scoredSessions.length,
    }
  }, [sessions])

  return (
    <section className="grid gap-4 sm:grid-cols-2" aria-label="Conversation insights">
      <article className="relative overflow-hidden rounded-xl2 border border-border bg-white p-5 shadow-sm">
        <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-signal-light" aria-hidden="true" />
        <div className="relative">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-signal-light text-signal" aria-hidden="true"><CalendarDays size={22} /></span>
          <p className="mt-4 text-sm font-bold uppercase tracking-wide text-text-2">Sessions this week</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-bold tracking-tight text-ink">{sessionsThisWeek}</span>
            <span className="text-base font-medium text-text-2">{sessionsThisWeek === 1 ? 'conversation' : 'conversations'}</span>
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-text-2"><Activity size={15} aria-hidden="true" /> Completed since Monday</p>
        </div>
      </article>
      <article className="relative overflow-hidden rounded-xl2 border border-border bg-white p-5 shadow-sm">
        <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-success-light" aria-hidden="true" />
        <div className="relative">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-success-light text-success-dark" aria-hidden="true"><Target size={22} /></span>
          <p className="mt-4 text-sm font-bold uppercase tracking-wide text-text-2">Average confidence</p>
          {averageConfidence !== null ? (
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-ink">{averageConfidence}</span>
              <span className="text-xl font-bold text-text-2">%</span>
            </div>
          ) : (
            <p className="mt-2 text-xl font-bold text-ink">No score yet</p>
          )}
          <p className="mt-3 text-sm font-medium text-text-2">{scoredSessionCount > 0 ? `From ${scoredSessionCount} recorded ${scoredSessionCount === 1 ? 'session' : 'sessions'}` : 'Scores appear after a recorded session'}</p>
        </div>
      </article>
    </section>
  )
}
