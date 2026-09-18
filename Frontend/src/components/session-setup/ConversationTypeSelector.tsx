import { HeartPulse, GraduationCap, Landmark, MoreHorizontal, type LucideIcon } from 'lucide-react'
import type { ConversationType } from '../../types/conversation'
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
  )
}
