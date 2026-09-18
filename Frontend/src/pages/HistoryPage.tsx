import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from 'lucide-react'
import {
  getSessions as getStoredSessions,
  deleteSession as deleteStoredSession,
} from "../services/sessionHistoryStorage";
import PageHeader from "../components/layout/PageHeader";
import FilterBar, {
  LocationFilter,
  RangeFilter,
} from "../components/history/FilterBar";
import SessionHistoryCard from "../components/history/SessionHistoryCard";
import Card from "../components/shared/Card";
import Button from '../components/shared/Button'
import { ConversationSession, SavedSession } from "../types/session";
import { ConversationType } from "../types/conversation";

const RANGE_DAYS: Record<RangeFilter, number | null> = {
  "7d": 7,
  "30d": 30,
  all: null,
};

// Maps a real saved session's conversation type onto the location-style
// labels FilterBar's location filter expects.
const CONVERSATION_TYPE_TO_LOCATION: Record<ConversationType, string> = {
  medical: "Hospital",
  school: "School",
  government: "Government office",
  other: "Other",
};

function toConversationSession(saved: SavedSession): ConversationSession {
  return {
    id: saved.id,
    title: saved.sessionName,
    location: CONVERSATION_TYPE_TO_LOCATION[saved.conversationType] ?? "Other",
    startedAt: saved.startedAt,
    durationMinutes: Math.max(0, Math.round(saved.durationSeconds / 60)),
    messageCount: saved.messages.length,
    avgConfidence: saved.avgConfidence ?? undefined,
  };
}

export default function HistoryPage() {
  const navigate = useNavigate();

  // Read once per page visit (mount) - HistoryPage remounts on every real
  // navigation to /history, so this always reflects the latest saves.
  // Real recorded sessions only - no seeded/mock demo data.
  const [storedSessions, setStoredSessions] = useState<SavedSession[]>(() =>
    getStoredSessions(),
  );

  const [search, setSearch] = useState("");
  const [location, setLocation] = useState<LocationFilter>("all");
  const [range, setRange] = useState<RangeFilter>("all");
  const [sessionPendingDeletion, setSessionPendingDeletion] = useState<ConversationSession | null>(null)

  const allSessions = useMemo(() => {
    return storedSessions
      .map(toConversationSession)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      );
  }, [storedSessions]);

  const filteredSessions = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    const rangeDays = RANGE_DAYS[range];
    const cutoff =
      rangeDays !== null ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null;

    return allSessions.filter((session) => {
      const matchesSearch =
        searchLower === "" ||
        session.title.toLowerCase().includes(searchLower) ||
        session.location.toLowerCase().includes(searchLower);

      const matchesLocation =
        location === "all" || session.location.toLowerCase().includes(location);

      const matchesRange =
        cutoff === null || new Date(session.startedAt).getTime() >= cutoff;

      return matchesSearch && matchesLocation && matchesRange;
    });
  }, [allSessions, search, location, range]);

  function handleReplay(session: ConversationSession) {
    navigate(`/summary/${session.id}`);
  }

  function handleDelete(session: ConversationSession) {
    deleteStoredSession(session.id); // removes it from localStorage too
    setStoredSessions((prev) => prev.filter((s) => s.id !== session.id));
    setSessionPendingDeletion(null)
  }

  function handleDownload(session: ConversationSession) {
    const stored = storedSessions.find((s) => s.id === session.id);
    const payload = stored ?? session;
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${session.title.trim().replace(/\s+/g, "-").toLowerCase() || "session"}-${session.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto flex h-full max-w-[1440px] flex-col px-3 py-4 sm:px-5 sm:py-6 lg:px-7">
      <div className="shrink-0">
        <PageHeader
          title="History"
          description="Every past conversation, searchable and ready to replay or export."
        />
      </div>
      <Card className="flex min-h-0 flex-1 flex-col border-border p-4 shadow-sm sm:p-5">
        <div className="shrink-0 border-b border-border pb-4">
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            location={location}
            onLocationChange={setLocation}
            range={range}
            onRangeChange={setRange}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-3 pr-1 custom-scrollbar">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <p className="text-sm font-semibold text-text-2" aria-live="polite">
              {filteredSessions.length} {filteredSessions.length === 1 ? 'session' : 'sessions'} shown
            </p>
            {(search || location !== 'all' || range !== 'all') && <p className="text-sm text-text-3">Filters applied</p>}
          </div>
          {filteredSessions.length === 0 && (
            <div className="rounded-xl2 bg-sky px-5 py-10 text-center text-base leading-relaxed text-text-2">
              {storedSessions.length === 0
                ? "No sessions yet - start a live conversation to see it here."
                : "No sessions match your filters."}
            </div>
          )}
          {filteredSessions.map((s) => (
            <SessionHistoryCard
              key={s.id}
              session={s}
              onReplay={handleReplay}
              onDownload={handleDownload}
              onDelete={setSessionPendingDeletion}
            />
          ))}
        </div>
      </Card>

      {sessionPendingDeletion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-session-title" aria-describedby="delete-session-description" className="w-full max-w-md rounded-xl2 border border-border bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-light text-danger" aria-hidden="true"><AlertTriangle size={23} /></span>
              <div>
                <h2 id="delete-session-title" className="text-xl font-bold text-ink">Delete this session?</h2>
                <p id="delete-session-description" className="mt-2 text-base leading-relaxed text-text-2"><span className="font-semibold text-ink">{sessionPendingDeletion.title}</span> and its transcript will be permanently removed from this device.</p>
              </div>
              <button type="button" onClick={() => setSessionPendingDeletion(null)} className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-text-2 hover:bg-sky focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]" aria-label="Keep session"><X size={22} /></button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Button type="button" onClick={() => setSessionPendingDeletion(null)} className="min-h-12 justify-center text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97]">Keep session</Button>
              <Button type="button" variant="danger-solid" onClick={() => handleDelete(sessionPendingDeletion)} className="min-h-12 justify-center text-base focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-danger active:scale-[0.97]">Delete session</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
