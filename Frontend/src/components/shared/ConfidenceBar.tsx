import { ConversationMessage } from '../../types/message'

export default function ConfidenceBar({ bar, rate } : {bar: ConversationMessage; rate: 'ok' | 'med'}) {
    const meter = rate === 'ok' ? 'bg-success-light' : 'bg-amber-light' 
    const progress = rate === 'ok' ? 'bg-success' : 'bg-amber'
    return (
      <div className={`h-[5px] rounded overflow-hidden mt-1 mb-1.5 ${meter}`}>
        <span className={`block h-full rounded ${progress}`} style={{ width: `${bar.confidence}%` }} />
      </div>
    )
}