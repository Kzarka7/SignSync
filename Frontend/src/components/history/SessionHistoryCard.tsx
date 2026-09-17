import { Video, Play, Download, Trash2 } from "lucide-react";
import { ConversationSession } from "../../types/session";
import Button from "../shared/Button";
import Badge from '../shared/Badge';

interface SessionHistoryCardProps {
  session: ConversationSession
  onReplay?: (session: ConversationSession) => void
  onDownload?: (session: ConversationSession) => void
  onDelete?: (session: ConversationSession) => void
}

export default function SessionHistoryCard({ session, onReplay, onDownload, onDelete }: SessionHistoryCardProps) {
  const hasConfidence = session.avgConfidence !== undefined;
  const lowConfidence = hasConfidence && (session.avgConfidence as number) < 90;

  return (
    <article className="mb-3 flex flex-col gap-4 rounded-xl2 border border-border bg-white p-4 shadow-sm sm:p-5 lg:flex-row lg:items-center lg:gap-5">
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-signal-light text-signal"
      >
        <Video size={22} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-lg font-bold text-ink">{session.title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm leading-relaxed text-text-2">
          <span>
            {new Date(session.startedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
          <span>{session.durationMinutes} min</span>
          <span>{session.messageCount} messages</span>
          {hasConfidence ? (
            <Badge tone={lowConfidence ? 'med' : 'ok'}>{session.avgConfidence}% confidence</Badge>
          ) : (
            <span className="font-medium text-text-3">No confidence data</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:flex lg:shrink-0">
        <Button size="md" className="min-h-11 justify-center text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]" onClick={() => onReplay?.(session)}>
          <Play size={17} aria-hidden="true" />
          <span>Replay</span>
        </Button>
        <Button size="md" title="Delete session" aria-label={`Delete ${session.title}`} variant="danger-solid" className="min-h-11 justify-center focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97]" onClick={() => onDelete?.(session)}>
          <Trash2 size={18} aria-hidden="true" />
        </Button>
        <Button
          size="md"
          title="Export session"
          aria-label={`Export ${session.title}`}
          variant="primary"
          className="min-h-11 justify-center font-bold focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]"
          onClick={() => onDownload?.(session)}
        >
          <Download size={18} aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}
