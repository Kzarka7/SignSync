import { HandMetal, Mic, MessageSquareText, RotateCcw, Copy, Pencil } from 'lucide-react'
import { ConversationMessage } from '../../types/message'
import Badge from '../shared/Badge'

export default function MessageBubble({ message }: { message: ConversationMessage }) {
  const isSign = message.source === 'sign'
  const isPhrase = message.source === 'phrase'
  const time = new Date(message.timestamp).toLocaleTimeString(undefined, { hour12: false })
  const hasConfidence = typeof message.confidence === 'number'
  const lowConfidence = hasConfidence && (message.confidence as number) < 90

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

      <div className="text-lg leading-relaxed mb-1.5">{message.text}</div>

      {hasConfidence && lowConfidence && (
        <div className="h-[5px] rounded bg-[#EAF0F6] overflow-hidden mt-1 mb-1.5">
          <span className="block h-full rounded bg-amber" style={{ width: `${message.confidence}%` }} />
        </div>
      )}

      <div className="flex items-center gap-3">
        {hasConfidence ? (
          <Badge className="text-sm" tone={(message.confidence as number) >= 90 ? 'ok' : 'med'}>{message.confidence}% confidence</Badge>
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
