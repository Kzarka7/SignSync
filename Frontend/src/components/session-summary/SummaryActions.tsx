import Button from '../shared/Button'

interface SummaryActionsProps {
  onStartNewConversation: () => void
  onDone: () => void
}

export default function SummaryActions({ onStartNewConversation, onDone }: SummaryActionsProps) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:justify-end">
      <Button variant="primary" onClick={onStartNewConversation} className="min-h-12 justify-center px-5 text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]">
        Start a new conversation
      </Button>
      <Button onClick={onDone} className="min-h-12 justify-center px-5 text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]">Back to history</Button>
    </div>
  )
}
