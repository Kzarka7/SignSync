import Card from '../shared/Card'
import Button from '../shared/Button'

interface SessionNotFoundCardProps {
  onBackToHistory: () => void
}

// Shown when the route's sessionId doesn't resolve to anything in either
// saved session history or the mock/demo sessions service.
export default function SessionNotFoundCard({ onBackToHistory }: SessionNotFoundCardProps) {
  return (
    <Card>
      <p className="text-sm text-text-2 mb-4">
        This session may have been deleted, or the link is no longer valid.
      </p>
      <Button variant="primary" onClick={onBackToHistory}>
        Back to History
      </Button>
    </Card>
  )
}
