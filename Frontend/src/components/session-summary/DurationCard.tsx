import { Clock3 } from 'lucide-react'
import Card from '../shared/Card'

interface DurationCardProps {
  durationLabel: string
  className?: string
}

export default function DurationCard({ durationLabel, className }: DurationCardProps) {
  return (
    <Card className={`border-border p-5 shadow-sm ${className ?? ''}`}>
      <div className='flex items-center gap-3'>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-signal-light text-signal" aria-hidden="true"><Clock3 size={20} /></span>
        <div className="text-sm font-bold uppercase tracking-wide text-text-2">Duration</div>
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight text-ink">{durationLabel}</div>
    </Card>
  )
}
