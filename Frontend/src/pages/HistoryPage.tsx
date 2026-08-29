import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAsync } from '../hooks/useAsync'
import { getAllSessions } from '../services/api/sessionsService'
import { getSessions as getStoredSessions, deleteSession as deleteStoredSession } from '../services/sessionHistoryStorage'
import PageHeader from '../components/layout/PageHeader'
import FilterBar, { LocationFilter, RangeFilter } from '../components/history/FilterBar'
import SessionHistoryCard from '../components/history/SessionHistoryCard'
import { ConversationSession, SavedSession } from '../types/session'
import { ConversationType } from '../types/conversation'

const RANGE_DAYS: Record<RangeFilter, number | null> = {
  '7d': 7,
  '30d': 30,
  all: null,
}

// Maps a real saved session's conversation type onto the same
// location-style labels the (mock) demo sessions use, so both flow
// through FilterBar's existing location filter unchanged.
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

export default function HistoryPage() {
  const navigate = useNavigate()
  const { data: mockSessions, loading } = useAsync(() => getAllSessions(), [])

  // Read once per page visit (mount) - HistoryPage remounts on every real
  // navigation to /history, so this always reflects the latest saves.
  const [storedSessions, setStoredSessions] = useState<SavedSession[]>(() => getStoredSessions())
  const [hiddenMockIds, setHiddenMockIds] = useState<Set<string>>(new Set())

  const [search, setSearch] = useState('')
  const [location, setLocation] = useState<LocationFilter>('all')
  const [range, setRange] = useState<RangeFilter>('all')

  const allSessions = useMemo(() => {
    const real = storedSessions.map(toConversationSession)
    const mock = (mockSessions ?? []).filter((s) => !hiddenMockIds.has(s.id))
    return [...real, ...mock].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  }, [storedSessions, mockSessions, hiddenMockIds])

  const filteredSessions = useMemo(() => {
    const searchLower = search.trim().toLowerCase()
    const rangeDays = RANGE_DAYS[range]
    const cutoff = rangeDays !== null ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null

    return allSessions.filter((session) => {
      const matchesSearch =
        searchLower === '' ||
        session.title.toLowerCase().includes(searchLower) ||
        session.location.toLowerCase().includes(searchLower)

      const matchesLocation = location === 'all' || session.location.toLowerCase().includes(location)

      const matchesRange = cutoff === null || new Date(session.startedAt).getTime() >= cutoff

      return matchesSearch && matchesLocation && matchesRange
    })
  }, [allSessions, search, location, range])

  function handleReplay(session: ConversationSession) {
    navigate(`/session-summary/${session.id}`)
  }

  function handleDelete(session: ConversationSession) {
    const isStored = storedSessions.some((s) => s.id === session.id)
    if (isStored) {
      deleteStoredSession(session.id) // removes it from localStorage too
      setStoredSessions((prev) => prev.filter((s) => s.id !== session.id))
    } else {
      // Seeded demo session - nothing in localStorage to remove, just
      // drop it from this view.
      setHiddenMockIds((prev) => new Set(prev).add(session.id))
    }
  }

  function handleDownload(session: ConversationSession) {
    const stored = storedSessions.find((s) => s.id === session.id)
    const payload = stored ?? session
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${session.title.trim().replace(/\s+/g, '-').toLowerCase() || 'session'}-${session.id}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader title="History" description="Every past conversation, searchable and ready to replay or export." />
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        location={location}
        onLocationChange={setLocation}
        range={range}
        onRangeChange={setRange}
      />
      {loading && <div className="text-sm text-text-2">Loading sessions...</div>}
      {!loading && filteredSessions.length === 0 && (
        <div className="text-sm text-text-2 py-8 text-center">No sessions match your filters.</div>
      )}
      {filteredSessions.map((s) => (
        <SessionHistoryCard
          key={s.id}
          session={s}
          onReplay={handleReplay}
          onDownload={handleDownload}
          onDelete={handleDelete}
        />
      ))}
    </div>
  )
}
