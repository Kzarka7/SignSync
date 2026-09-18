import { MessageSquareText } from 'lucide-react'
import Card from '../shared/Card'

interface MessageCountCardProps {
  messageCount: number
  className?: string
}

export default function MessageCountCard({ messageCount, className }: MessageCountCardProps) {
  return (
    <Card className={`border-border p-5 shadow-sm ${className ?? ''}`}>
      <div className='flex items-center gap-3'>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-light text-success-dark" aria-hidden="true"><MessageSquareText size={20} /></span>
        <div className="text-sm font-bold uppercase tracking-wide text-text-2">Messages</div>
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight text-ink">{messageCount}</div>
    </Card>
  )
}
