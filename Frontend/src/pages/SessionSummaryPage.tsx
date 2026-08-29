import { useNavigate, useParams } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import Card from "../components/shared/Card";
import Button from "../components/shared/Button";
import Badge from "../components/shared/Badge";
import MessageBubble from "../components/live/MessageBubble";
import { useAsync } from "../hooks/useAsync";
import { getSessionById as getStoredSessionById } from "../services/sessionHistoryStorage";
import { getSessionById as getMockSessionById } from "../services/api/sessionsService";
import { getMessagesForSession } from "../services/api/messagesService";
import {
  CONVERSATION_TYPE_LABELS,
  ConversationType,
} from "../types/conversation";
import { ConversationMessage } from "../types/message";

interface SummaryViewModel {
  sessionName: string;
  conversationTypeLabel: string;
  startedAt: string;
  durationLabel: string;
  messages: ConversationMessage[];
  avgConfidence: number | null;
  phrasesUsed: string[];
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(safeSeconds / 60);
  const s = safeSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Looks in real saved session history first (the normal path, right after
// End Session). Falls back to the mock/demo session + messages services so
// "Replay" on a seeded History entry still shows something, rather than a
// dead end.
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
        <Card>
          <p className="text-sm text-text-2 mb-4">
            This session may have been deleted, or the link is no longer valid.
          </p>
          <Button variant="primary" onClick={() => navigate("/history")}>
            Back to History
          </Button>
        </Card>
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
          <Card className="col-span-2 row-span-2">
            <div className="text-sm text-text-2 mb-1">Duration</div>
            <div className="text-xl font-semibold">{summary.durationLabel}</div>
          </Card>
          
          <Card className="col-span-2 row-span-2 col-start-1 row-start-3">
            <div className="text-sm text-text-2 mb-1">Messages</div>
            <div className="text-xl font-semibold">
              {summary.messages.length}
            </div>
          </Card>

          <Card className="col-span-3 row-span-4 col-start-3 row-start-1">
            <div className="text-sm text-text-2 mb-1">Avg. confidence</div>
            {summary.avgConfidence !== null ? (
              <Badge tone={summary.avgConfidence >= 90 ? "ok" : "med"}>
                {summary.avgConfidence}%
              </Badge>
            ) : (
              <div className="text-sm text-text-2">Not available</div>
            )}
          </Card>

          <Card className="srhink-0 col-span-5 row-span-4 col-start-6 row-start-1">
            <h3 className="text-md uppercase tracking-wide text-text-2 font-semibold mb-3">
              Phrases used
            </h3>
            {summary.phrasesUsed.length === 0 ? (
              <p className="text-sm text-text-2">
                No quick phrases were used in this session.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {summary.phrasesUsed.map((phrase) => (
                  <span
                    key={phrase}
                    className="inline-flex items-center bg-signal-light text-[#0c447c] rounded-md px-3.5 py-1.5 text-sm font-medium"
                  >
                    {phrase}
                  </span>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Card className="flex-1 min-h-0 flex flex-col">
          <h3 className="shrink-0 text-md uppercase tracking-wide text-text-2 font-semibold mb-3">
            Transcript
          </h3>
          {summary.messages.length === 0 ? (
            <p className="text-sm text-text-2">
              No messages were recorded during this session.
            </p>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col divide-y divide-border [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-1">
              {summary.messages.map((m) => (
                <div key={m.id} className="py-3 first:pt-0 last:pb-0">
                  <MessageBubble message={m} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="shrink-0 flex gap-2.5">
          <Button variant="primary" onClick={() => navigate("/session-setup")}>
            Start a new conversation?
          </Button>
          <Button onClick={() => navigate("/history")}>Done</Button>
        </div>
      </div>
    </div>
  );
}
