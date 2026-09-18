import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import SessionNotFoundCard from "../components/session-summary/SessionNotFoundCard";
import DurationCard from "../components/session-summary/DurationCard";
import MessageCountCard from "../components/session-summary/MessageCountCard";
import ConfidenceCard from "../components/session-summary/ConfidenceCard";
import PhrasesUsedCard from "../components/session-summary/PhrasesUsedCard";
import TranscriptCard from "../components/session-summary/TranscriptCard";
import SummaryActions from "../components/session-summary/SummaryActions";
import { useAsync } from "../hooks/useAsync";
import { getSessionById as getStoredSessionById } from "../services/sessionHistoryStorage";
import {
  CONVERSATION_TYPE_LABELS,
  ConversationType,
} from "../types/conversation";
import { ConfidenceBreakdown, ConversationMessage } from "../types/message";
import { averageConfidenceByCategory } from "../utils/confidence";

interface SummaryViewModel {
  sessionName: string;
  conversationTypeLabel: string;
  startedAt: string;
  durationLabel: string;
  messages: ConversationMessage[];
  avgConfidence: number | null;
  // Per-category averages across this session's messages (Sign
  // recognition/Speech recognition/Translation) - computed straight from
  // `messages` below, the same data the transcript rows already read, so
  // this container and the transcript never disagree.
  categoryAverages: ConfidenceBreakdown;
  phrasesUsed: string[];
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

async function loadSummary(
  sessionId: string | undefined,
): Promise<SummaryViewModel | null> {
  if (!sessionId) return null;

  const stored = getStoredSessionById(sessionId);
  if (!stored) return null;

  return {
    sessionName: stored.sessionName,
    conversationTypeLabel:
      CONVERSATION_TYPE_LABELS[stored.conversationType as ConversationType] ??
      stored.conversationType,
    startedAt: stored.startedAt,
    durationLabel: formatDuration(stored.durationSeconds),
    messages: stored.messages,
    avgConfidence: stored.avgConfidence,
    categoryAverages: averageConfidenceByCategory(stored.messages),
    phrasesUsed: stored.phrasesUsed,
  };
}

export default function SessionSummaryPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { data: summary, loading } = useAsync(
    () => loadSummary(sessionId),
    [sessionId],
  );

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[50vh] max-w-[1440px] items-center justify-center px-4">
        <div
          className="rounded-xl2 border border-border bg-white px-5 py-4 text-base font-medium text-text-2 shadow-sm"
          role="status"
        >
          Loading session summary…
        </div>
      </main>
    );
  }

  if (!summary) {
    return (
      <main className="mx-auto max-w-[1440px] px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
        <PageHeader
          title="Session summary"
          description="We couldn't find this session."
        />
        <SessionNotFoundCard onBackToHistory={() => navigate("/history")} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5.75rem)] max-w-[1440px] flex-col px-3 py-4 sm:px-5 sm:py-6 xl:h-[calc(100vh-5.75rem)] xl:overflow-hidden lg:px-7">
      <div className="shrink-0">
        <PageHeader
          title={summary.sessionName}
          description={`${summary.conversationTypeLabel} · ${new Date(
            summary.startedAt,
          ).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}`}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 pb-5 xl:flex-row">
        <section className="grid shrink-0 gap-4 sm:grid-cols-2 xl:max-h-full xl:self-start xl:grid-cols-6" aria-label="Session overview">
          <div className="grid sm:grid-cols-[3fr_5fr] sm:grid-rows-2 sm:col-span-2 xl:col-span-6 gap-4">
            <DurationCard durationLabel={summary.durationLabel} />

            <MessageCountCard messageCount={summary.messages.length} className="sm:col-start-1 sm:row-start-2" />

            <ConfidenceCard
              avgConfidence={summary.avgConfidence}
              categoryAverages={summary.categoryAverages}
              className="sm:row-span-2 sm:col-start-2 sm:row-start-1"
            />
          </div>

          <PhrasesUsedCard
            phrases={summary.phrasesUsed}
            className="sm:col-span-2 xl:col-span-6 xl:row-start-2"
          />
        </section>

        <TranscriptCard
          messages={summary.messages}
          sessionStartedAt={new Date(summary.startedAt).getTime()}
          className="flex-1 min-h-0 flex flex-col"
        />
      </div>
      
        <SummaryActions
          onStartNewConversation={() => navigate("/session-setup")}
          onDone={() => navigate("/history")}
        />
    </main>
  );
}
