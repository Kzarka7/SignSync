import { useAsync } from '../hooks/useAsync'
import { getAllSessions } from '../services/api/sessionsService'
import PageHeader from '../components/layout/PageHeader'
import FilterBar from '../components/history/FilterBar'
import SessionHistoryCard from '../components/history/SessionHistoryCard'

export default function HistoryPage() {
  const { data: sessions, loading } = useAsync(() => getAllSessions(), [])

  return (
    <div>
      <PageHeader title="History" description="Every past conversation, searchable and ready to replay or export." />
      <FilterBar />
      {loading && <div className="text-sm text-text-2">Loading sessions...</div>}
      {sessions?.map((s) => (
        <SessionHistoryCard key={s.id} session={s} />
      ))}
    </div>
  )
}
