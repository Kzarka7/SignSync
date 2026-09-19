import { Info, HandMetal, PlayCircle, AlertTriangle, BookOpen, ShieldCheck } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import FAQCard from '../components/faq/FAQCard'

const resources = [
  { icon: Info, title: 'How to use SignSync', description: 'A short walkthrough of starting a session, camera positioning, and reading the timeline.' },
  { icon: ShieldCheck, title: 'How we handle your privacy', description: 'Hand detection runs locally in your browser and never leaves your device. Speech recognition uses your browser\u2019s built-in service, which may send audio to your browser\u2019s provider (e.g. Google for Chrome/Edge) for transcription \u2014 no audio or video is stored by SignSync itself.' },
  { icon: HandMetal, title: 'Common FSL phrases', description: 'Browse everyday signs by category, with example clips for each one.' },
  { icon: PlayCircle, title: 'Tutorial videos', description: 'Short recordings covering setup, calibration, and troubleshooting.' },
  { icon: AlertTriangle, title: 'Emergency phrases', description: 'Pre-translated urgent phrases for quick access during a crisis.' },
  { icon: BookOpen, title: 'Contact support', description: 'Reach the project team for feedback or an accessibility request.' },
]

export default function FAQPage() {
  return (
    <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <PageHeader title="FAQ" description="Learn the system, browse common phrases, and find help when you need it." />
      <section aria-labelledby="help-topics-title" className="rounded-xl2 border border-border bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <h2 id="help-topics-title" className="text-xl font-bold text-ink">Help topics</h2>
            <p className="mt-1 text-base text-text-2">Clear guidance for using SignSync confidently.</p>
          </div>
          <span className="text-sm font-semibold text-text-2">{resources.length} guides</span>
        </div>
      <div className="grid gap-4 md:grid-cols-2">
        {resources.map((r) => (
          <FAQCard key={r.title} {...r} />
        ))}
      </div>
      </section>
    </main>
  )
}
