import { HeartPulse, GraduationCap, Landmark, MoreHorizontal, type LucideIcon } from 'lucide-react'
import type { ConversationType } from '../../types/conversation'
import Card from '../shared/Card'
import Button from '../shared/Button'

const TYPES: { value: ConversationType; label: string; icon: LucideIcon }[] = [
  { value: 'medical', label: 'Medical', icon: HeartPulse },
  { value: 'school', label: 'School', icon: GraduationCap },
  { value: 'government', label: 'Government', icon: Landmark },
  { value: 'other', label: 'Other', icon: MoreHorizontal },
]

interface ConversationTypeSelectorProps {
  value: ConversationType
  onChange: (type: ConversationType) => void
}

// Reused on both the Dashboard (initial pick, before navigating to
// Session Setup) and the Session Setup page itself (pre-selected but
// editable) - single reusable component instead of two separate pickers.
export default function ConversationTypeSelector({ value, onChange }: ConversationTypeSelectorProps) {
  return (
    <Card className="border-border p-4 shadow-sm sm:p-5">
      <div className="mb-4 grid grid-cols-[1fr_20fr] items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center font-bold text-xl rounded-full bg-signal-light text-signal">1</span>
        <div>
          <div className="flex justify-between">
            <h2 className="text-xl font-bold text-ink">Choose a conversation type</h2>
            <p className="text-base text-sm leading-relaxed text-text-3">select one category</p>
          </div>
          <p className="text-base text-text-2">This helps prepare the right phrases and context for your conversation.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 border-t border-border pt-4">
        {TYPES.map(({ value: typeValue, label, icon: Icon }) => (
          <Button
            key={typeValue}
            onClick={() => onChange(typeValue)}
            variant={value === typeValue ? 'primary-ghost' : 'default'}
            aria-pressed={value === typeValue}
            className="min-h-[104px] flex-col items-center justify-center gap-2 rounded-xl2 border px-2 py-3 text-base transition-colors focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]"
          >
            <Icon size={24} />
            <span className="text-base font-semibold">{label}</span>
          </Button>
        ))}
      </div>
    </Card>
  )
}
