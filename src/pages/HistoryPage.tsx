import { useMemo, useState } from 'react'
import { useAsync } from '../hooks/useAsync'
import { getAllSessions } from '../services/api/sessionsService'
import PageHeader from '../components/layout/PageHeader'
import FilterBar, { LocationFilter, RangeFilter } from '../components/history/FilterBar'
import SessionHistoryCard from '../components/history/SessionHistoryCard'

const RANGE_DAYS: Record<RangeFilter, number | null> = {
  '7d': 7,
  '30d': 30,
  all: null,
}

export default function HistoryPage() {
  const { data: sessions, loading } = useAsync(() => getAllSessions(), [])

  const [search, setSearch] = useState('')
  const [location, setLocation] = useState<LocationFilter>('all')
  const [range, setRange] = useState<RangeFilter>('30d')

  const filteredSessions = useMemo(() => {
    if (!sessions) return []

    const searchLower = search.trim().toLowerCase()
    const rangeDays = RANGE_DAYS[range]
    const cutoff = rangeDays !== null ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null

    return sessions.filter((session) => {
      const matchesSearch =
        searchLower === '' ||
        session.title.toLowerCase().includes(searchLower) ||
        session.location.toLowerCase().includes(searchLower)

      const matchesLocation = location === 'all' || session.location.toLowerCase().includes(location)

      const matchesRange = cutoff === null || new Date(session.startedAt).getTime() >= cutoff

      return matchesSearch && matchesLocation && matchesRange
    })
  }, [sessions, search, location, range])

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
        <SessionHistoryCard key={s.id} session={s} />
      ))}
    </div>
  )
}
