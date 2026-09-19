import { CalendarClock, Info, Tag } from 'lucide-react'
import Card from '../shared/Card'
import { CONVERSATION_TYPE_LABELS, type ConversationType } from '../../types/conversation'

interface SessionDetailsProps {
  sessionName: string
  onSessionNameChange: (value: string) => void
  timestamp: Date
  conversationType: ConversationType
}

export default function SessionDetails({
  sessionName,
  onSessionNameChange,
  timestamp,
  conversationType,
}: SessionDetailsProps) {
  return (
    <Card className="border-border p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center font-bold text-xl rounded-full bg-signal-light text-signal">2</span>
        <div>
          <h2 className="text-xl font-bold text-ink">Session details</h2>
          <p className="text-base text-text-2">Optional information for finding this session later.</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 border-t border-border pt-4">
        <div>
          <label htmlFor="session-name" className="mb-1.5 block text-base font-bold text-ink">Session name <span className="font-normal text-text-3">(optional)</span></label>
          <input
            id="session-name"
            type="text"
            value={sessionName}
            onChange={(e) => onSessionNameChange(e.target.value)}
            placeholder="e.g. Hospital reception, 2nd floor"
            className="min-h-12 w-full rounded-lg border border-border bg-white px-3 text-base font-medium text-ink placeholder:text-text-3 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col justify-center rounded-lg bg-sky px-3 py-3">
            <span className="flex items-center gap-1.5 text-sm font-bold text-text-2"><CalendarClock size={16} aria-hidden="true" /> Started</span>
            <span className="mt-1 block text-base font-bold text-ink">
              {timestamp.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <div className="flex flex-col justify-center rounded-lg bg-sky px-3 py-3">
            <span className="flex items-center gap-1.5 text-sm font-bold text-text-2"><Tag size={16} aria-hidden="true" /> Category</span>
            <span className="mt-1 block text-base font-bold text-ink">{CONVERSATION_TYPE_LABELS[conversationType]}</span>
          </div>
        </div>
      </div>
    </Card>
  )
}
