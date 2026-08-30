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
import { getSessionById as getMockSessionById } from "../services/api/sessionsService";
import { getMessagesForSession } from "../services/api/messagesService";
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
  if (stored) {
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

  const mockSession = await getMockSessionById(sessionId);
  if (!mockSession) return null;
  const messages = await getMessagesForSession(sessionId);
  return {
    sessionName: mockSession.title,
    conversationTypeLabel: mockSession.location,
    startedAt: mockSession.startedAt,
    durationLabel: formatDuration(mockSession.durationMinutes * 60),
    messages,
    avgConfidence: mockSession.avgConfidence ?? null,
    categoryAverages: averageConfidenceByCategory(messages),
    phrasesUsed: [],
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
      <div className="text-sm text-text-2">Loading session summary...</div>
    );
  }

  if (!summary) {
    return (
      <div>
        <PageHeader
          title="Session summary"
          description="We couldn't find this session."
        />
        <SessionNotFoundCard onBackToHistory={() => navigate("/history")} />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-5.75rem)] flex flex-col">
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

      <div className="flex-1 min-h-0 flex flex-col gap-4">
        <div className="shrink-0 grid grid-cols-10 grid-rows-4 gap-4">
          <DurationCard durationLabel={summary.durationLabel} className="col-span-2 row-span-2" />

          <MessageCountCard
            messageCount={summary.messages.length}
            className="col-span-2 row-span-2 col-start-1 row-start-3"
          />

          <ConfidenceCard
            avgConfidence={summary.avgConfidence}
            categoryAverages={summary.categoryAverages}
            className="col-span-3 row-span-4 col-start-3 row-start-1"
          />

          <PhrasesUsedCard
            phrases={summary.phrasesUsed}
            className="shrink-0 col-span-5 row-span-4 col-start-6 row-start-1"
          />
        </div>

        <TranscriptCard
          messages={summary.messages}
          sessionStartedAt={new Date(summary.startedAt).getTime()}
          className="flex-1 min-h-0 flex flex-col"
        />

        <SummaryActions
          onStartNewConversation={() => navigate("/session-setup")}
          onDone={() => navigate("/history")}
        />
      </div>
    </div>
  );
}
