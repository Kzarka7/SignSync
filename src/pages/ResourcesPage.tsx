import { Info, HandMetal, PlayCircle, AlertTriangle, HelpCircle, BookOpen } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import ResourceCard from '../components/resources/ResourceCard'

const resources = [
  { icon: Info, title: 'How to use Daloy', description: 'A short walkthrough of starting a session, camera positioning, and reading the timeline.' },
  { icon: HandMetal, title: 'Common FSL phrases', description: 'Browse everyday signs by category, with example clips for each one.' },
  { icon: PlayCircle, title: 'Tutorial videos', description: 'Short recordings covering setup, calibration, and troubleshooting.' },
  { icon: AlertTriangle, title: 'Emergency phrases', description: 'Pre-translated urgent phrases for quick access during a crisis.' },
  { icon: HelpCircle, title: 'Frequently asked questions', description: 'Answers about accuracy, privacy, and offline use.' },
  { icon: BookOpen, title: 'Contact support', description: 'Reach the project team for feedback or an accessibility request.' },
]

export default function ResourcesPage() {
  return (
    <div>
      <PageHeader title="Resources" description="Learn the system, browse common phrases, and find help when you need it." />
      <div className="grid grid-cols-3 gap-4">
        {resources.map((r) => (
          <ResourceCard key={r.title} {...r} />
        ))}
      </div>
    </div>
  )
}
