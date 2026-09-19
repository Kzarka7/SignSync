import { useDeviceStatus } from '../hooks/useDeviceStatus'
import StatusPill from '../components/shared/StatusPill'
import PageHeader from '../components/layout/PageHeader'
import QuickStartCard from '../components/dashboard/QuickStartCard'
import MetricGrid from '../components/dashboard/MetricGrid'
import RecentSessions from '../components/dashboard/RecentSessions'
import FrequentPhrases from '../components/dashboard/FrequentPhrases'

// Morning 5-11, Afternoon 12-16, Evening 17-20, Night 21-4 (wraps past midnight).
function getGreeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  if (hour >= 17 && hour < 21) return 'Good evening'
  return 'Good night'
}

export default function DashboardPage() {
  const status = useDeviceStatus()

  return (
    <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <PageHeader
        title={getGreeting(new Date().getHours())}
        description="Camera, microphone and translation engine are all ready. Start a conversation whenever you need it."
      />

      <div className="mb-5 grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(390px,1fr)] xl:gap-6">
        <QuickStartCard />
        <MetricGrid />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)] xl:gap-6">
        <RecentSessions />
        <FrequentPhrases />
      </div>
    </main>
  )
}