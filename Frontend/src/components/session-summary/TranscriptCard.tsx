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
    <Card className={`border-border p-4 shadow-sm sm:p-5 ${className ?? ''}`}>
      <div className="mb-3 flex shrink-0 items-baseline justify-between gap-3">
        <h2 className="text-xl font-bold text-ink">Transcript</h2>
        <span className="text-sm font-semibold text-text-2">{messages.length} {messages.length === 1 ? 'message' : 'messages'}</span>
      </div>
      {messages.length === 0 ? (
        <p className="rounded-lg bg-sky px-4 py-5 text-base text-text-2">No messages were recorded during this session.</p>
      ) : (
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col divide-y divide-border overflow-y-auto pr-2" aria-label="Session transcript">
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
