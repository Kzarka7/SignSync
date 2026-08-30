import Card from '../shared/Card'
import MessageBubble from '../live/MessageBubble'
import { ConversationMessage } from '../../types/message'

interface TranscriptCardProps {
  messages: ConversationMessage[]
  sessionStartedAt: number
  className?: string
}

// Session Summary is History's per-message replay view - unlike the live
// transcript, it's pinned to this session's own start time (not the live
// session's) and shows every confidence category, not just the overall
// figure the History list already shows.
export default function TranscriptCard({ messages, sessionStartedAt, className }: TranscriptCardProps) {
  return (
    <Card className={className}>
      <h3 className="shrink-0 text-md uppercase tracking-wide text-text-2 font-semibold mb-3">Transcript</h3>
      {messages.length === 0 ? (
        <p className="text-sm text-text-2">No messages were recorded during this session.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col divide-y divide-border pr-1 custom-scrollbar">
          {messages.map((m) => (
            <div key={m.id} className="py-3 first:pt-0 last:pb-0">
              <MessageBubble message={m} sessionStartedAt={sessionStartedAt} showConfidenceBreakdown />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
