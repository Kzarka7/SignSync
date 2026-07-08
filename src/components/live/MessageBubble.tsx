import { HandMetal, Mic, RotateCcw, Copy, Pencil } from 'lucide-react'
import { ConversationMessage } from '../../types/message'

export default function MessageBubble({ message }: { message: ConversationMessage }) {
  const isSign = message.source === 'sign'
  const time = new Date(message.timestamp).toLocaleTimeString(undefined, { hour12: false })
  const lowConfidence = message.confidence < 90

  return (
    <div
      className="pl-4 relative"
      style={{ borderLeft: `3px solid ${isSign ? '#2D7FF9' : '#1B4B66'}` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-2">
          <span className={`w-5 h-5 rounded-md flex items-center justify-center ${isSign ? 'bg-signal-light text-signal' : 'bg-[#EFF3F7] text-trust'}`}>
            {isSign ? <HandMetal size={12} /> : <Mic size={12} />}
          </span>
          {isSign ? 'Signed' : 'Spoken'}
        </span>
        <span className="font-mono text-xs text-text-3 ml-auto">{time}</span>
      </div>

      <div className="text-md leading-relaxed mb-1.5">{message.text}</div>

      {lowConfidence && (
        <div className="h-[5px] rounded bg-[#EAF0F6] overflow-hidden mt-1 mb-1.5">
          <span className="block h-full rounded bg-amber" style={{ width: `${message.confidence}%` }} />
        </div>
      )}

      <div className="flex items-center gap-3">
        <span
          className={`font-mono text-[11px] px-1.5 py-0.5 rounded-md ${
            lowConfidence ? 'text-[#8a5a10] bg-amber-light' : 'text-success bg-success-light'
          }`}
        >
          {message.confidence}% match{lowConfidence ? ' — review suggested' : ''}
        </span>
        <div className="flex gap-1 ml-auto">
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-3 hover:bg-[#F0F4F8] hover:text-ink" title="Replay">
            <RotateCcw size={13} />
          </button>
          <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-3 hover:bg-[#F0F4F8] hover:text-ink" title="Copy">
            <Copy size={13} />
          </button>
          {lowConfidence && (
            <button className="w-6 h-6 rounded-md flex items-center justify-center text-text-3 hover:bg-[#F0F4F8] hover:text-ink" title="Edit">
              <Pencil size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
