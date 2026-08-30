import { HandMetal, Mic, MessageSquareText, RotateCcw, Copy, Pencil } from 'lucide-react'
import { ConversationMessage } from '../../types/message'
import Badge from '../shared/Badge'
import ConfidenceBar from '../shared/ConfidenceBar'
import { useSessionStore } from '../../store/sessionStore'
import { formatElapsedTime, elapsedSecondsBetween } from '../../utils/time'
import { CONFIDENCE_CATEGORY_LABELS } from '../../utils/confidence'

interface MessageBubbleProps {
  message: ConversationMessage
  // Epoch ms the message's session started at. Defaults to the live
  // session's own startedAt (from sessionStore) - the same clock/time
  // source LiveTopbar's counter reads - so Live Conversation needs no
  // separate timer. History's Replay/Session Summary view passes the
  // *saved* session's own startedAt instead, since the live store no
  // longer reflects a past session.
  sessionStartedAt?: number | null
  // Only the History Replay/Session Summary transcript sets this - Live
  // Conversation and the History list both keep showing just the overall
  // confidence.
  showConfidenceBreakdown?: boolean
}

export default function MessageBubble({ message, sessionStartedAt, showConfidenceBreakdown = false }: MessageBubbleProps) {
  const liveStartedAt = useSessionStore((s) => s.startedAt)
  const startedAt = sessionStartedAt !== undefined ? sessionStartedAt : liveStartedAt

  const isSign = message.source === 'sign'
  const isPhrase = message.source === 'phrase'
  const time =
    startedAt != null
      ? formatElapsedTime(elapsedSecondsBetween(startedAt, new Date(message.timestamp).getTime()))
      : new Date(message.timestamp).toLocaleTimeString(undefined, { hour12: false })
  const hasConfidence = typeof message.confidence === 'number'
  const lowConfidence = hasConfidence && (message.confidence as number) < 90
  const breakdownEntries = showConfidenceBreakdown
    ? Object.entries(message.confidenceBreakdown ?? {}).filter(
        (entry): entry is [keyof typeof CONFIDENCE_CATEGORY_LABELS, number] => typeof entry[1] === 'number',
      )
    : []

  const accentColor = isSign ? '#2D7FF9' : isPhrase ? '#1FAA59' : '#1B4B66'
  const iconBg = isSign ? 'bg-signal-light text-signal' : isPhrase ? 'bg-success-light text-success-dark' : 'bg-[#EFF3F7] text-trust'
  const icon = isSign ? <HandMetal size={16} /> : isPhrase ? <MessageSquareText size={16} /> : <Mic size={16} />
  const label = isSign ? 'Signed' : isPhrase ? 'Phrase' : 'Spoken'

  return (
    <div
      className="pl-4 relative"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-text-2">
          <span className={`w-8 h-8 rounded-md flex items-center justify-center ${iconBg}`}>
            {icon}
          </span>
          {label}
        </span>
        <span className="font-mono font-medium text-sm text-text-3 ml-auto">{time}</span>
      </div>

      <div className="text-md leading-relaxed mb-1.5">{message.text}</div>

      {hasConfidence && (
        <ConfidenceBar 
          bar={message}
          rate={(message.confidence ?? 0) >= 90 ? 'ok' : 'med'}
        />
      )}

      {breakdownEntries.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {breakdownEntries.map(([category, value]) => (
            <Badge key={category} className="text-xs" tone={value >= 90 ? 'ok' : 'med'}>
              {CONFIDENCE_CATEGORY_LABELS[category]}: {value}% confidence
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        {hasConfidence ? (
          <Badge className="text-sm" tone={(message.confidence as number) >= 90 ? 'ok' : 'med'}>
            {breakdownEntries.length > 0 ? 'Overall: ' : ''}{message.confidence}% confidence
          </Badge>
        ) : (
          <span className="text-sm text-text-3">Manually selected</span>
        )}
        <div className="flex gap-1 ml-auto">
          <button className="w-8 h-8 rounded-md flex items-center justify-center text-text-3 hover:bg-[#F0F4F8] hover:text-ink" title="Replay">
            <RotateCcw size={16} />
          </button>
          <button className="w-8 h-8 rounded-md flex items-center justify-center text-text-3 hover:bg-[#F0F4F8] hover:text-ink" title="Copy">
            <Copy size={16} />
          </button>
          {hasConfidence && lowConfidence && (
            <button className="w-8 h-8 rounded-md flex items-center justify-center text-text-3 hover:bg-[#F0F4F8] hover:text-ink" title="Edit">
              <Pencil size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
