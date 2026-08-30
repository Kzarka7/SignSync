import Card from '../shared/Card'

interface DurationCardProps {
  durationLabel: string
  className?: string
}

export default function DurationCard({ durationLabel, className }: DurationCardProps) {
  return (
    <Card className={className}>
      <div className="text-sm text-text-2 mb-1">Duration</div>
      <div className="text-xl font-semibold">{durationLabel}</div>
    </Card>
  )
}
