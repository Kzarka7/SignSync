import Card from '../shared/Card'

interface MessageCountCardProps {
  messageCount: number
  className?: string
}

export default function MessageCountCard({ messageCount, className }: MessageCountCardProps) {
  return (
    <Card className={className}>
      <div className="text-sm text-text-2 mb-1">Messages</div>
      <div className="text-xl font-semibold">{messageCount}</div>
    </Card>
  )
}
