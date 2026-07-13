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
    <div className="grid grid-cols-4 gap-2.5">
      {TYPES.map(({ value: typeValue, label, icon: Icon }) => (
        <Button
          key={typeValue}
          onClick={() => onChange(typeValue)}
          variant={value === typeValue ? 'primary-ghost' : 'default'}
          className=" flex-col items-center gap-2 py-3.5 px-2 rounded-xl2 border transition-colors"
        >
          <Icon size={20} />
          <span className="text-xs font-semibold">{label}</span>
        </Button>
      ))}
    </div>
  )
}
