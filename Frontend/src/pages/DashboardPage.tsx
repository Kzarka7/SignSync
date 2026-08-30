import { useDeviceStatus } from '../hooks/useDeviceStatus'
import StatusPill from '../components/shared/StatusPill'
import PageHeader from '../components/layout/PageHeader'
import QuickStartCard from '../components/dashboard/QuickStartCard'
import MetricGrid from '../components/dashboard/MetricGrid'
import RecentSessions from '../components/dashboard/RecentSessions'
import FrequentPhrases from '../components/dashboard/FrequentPhrases'

export default function DashboardPage() {
  const status = useDeviceStatus()

  return (
    <div>
      <PageHeader
        title="Good afternoon"
        description="Camera, microphone and translation engine are all ready. Start a conversation whenever you need it."
        actions={
          status && (
            <div className="flex gap-2.5 flex-wrap">
              <StatusPill label="Camera" state={status.camera} />
              <StatusPill label="Microphone" state={status.microphone} />
              <StatusPill label="AI engine" state={status.ai} />
            </div>
          )
        }
      />

      <div className="grid grid-cols-[1.6fr_1fr] gap-4.5 mb-5" style={{ gap: '18px' }}>
        <QuickStartCard />
        <MetricGrid />
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-4.5 items-start" style={{ gap: '18px' }}>
        <RecentSessions />
        <FrequentPhrases />
      </div>
    </div>
  )
}
