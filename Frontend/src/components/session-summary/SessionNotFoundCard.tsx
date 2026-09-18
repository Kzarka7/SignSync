import Card from '../shared/Card'
import Button from '../shared/Button'

interface SessionNotFoundCardProps {
  onBackToHistory: () => void
}

// Shown when the route's sessionId doesn't resolve to anything in either
// saved session history or the mock/demo sessions service.
export default function SessionNotFoundCard({ onBackToHistory }: SessionNotFoundCardProps) {
  return (
    <Card className="max-w-xl border-border p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-bold text-ink">Session unavailable</h2>
      <p className="mb-5 mt-2 text-base leading-relaxed text-text-2">
        This session may have been deleted, or the link is no longer valid.
      </p>
      <Button variant="primary" onClick={onBackToHistory} className="min-h-12 px-5 text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]">
        Back to History
      </Button>
    </Card>
  )
}
