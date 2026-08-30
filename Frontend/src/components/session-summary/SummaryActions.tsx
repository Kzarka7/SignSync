import Button from '../shared/Button'

interface SummaryActionsProps {
  onStartNewConversation: () => void
  onDone: () => void
}

export default function SummaryActions({ onStartNewConversation, onDone }: SummaryActionsProps) {
  return (
    <div className="shrink-0 flex gap-2.5">
      <Button variant="primary" onClick={onStartNewConversation}>
        Start a new conversation?
      </Button>
      <Button onClick={onDone}>Done</Button>
    </div>
  )
}
