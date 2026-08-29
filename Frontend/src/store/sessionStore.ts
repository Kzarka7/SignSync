import { create } from "zustand";

// Persists the session's start time (not the whole store) to localStorage,
// so refreshing the Live Conversation page - or briefly navigating away
// and back - doesn't reset the running timer back to zero.
const STORAGE_KEY = "daloy:session-started-at";
// Persisted alongside the start time so a page refresh mid-session keeps
// pointing at the same session id (used later to save/finalize History).
const ID_STORAGE_KEY = "daloy:session-id";

function readStoredStartTime(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    // localStorage unavailable (private/incognito mode, or disabled) -
    // fall back to an in-memory-only session further down.
    return null;
  }
}

function writeStoredStartTime(startedAt: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(startedAt));
  } catch {
    // Not fatal - the session just won't survive a refresh this time.
  }
}

function clearStoredStartTime() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readStoredSessionId(): string | null {
  try {
    return localStorage.getItem(ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredSessionId(id: string) {
  try {
    localStorage.setItem(ID_STORAGE_KEY, id);
  } catch {
    // ignore
  }
}

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function computeElapsedSeconds(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

interface SessionStoreState {
  isSessionActive: boolean;
  // Identifies the current/most-recently-run live session, so it can be
  // saved to session history and later re-saved (upserted) without
  // creating a duplicate History record if "End session" fires twice.
  sessionId: string | null;
  startedAt: number | null; // epoch ms
  elapsedSeconds: number;
  startSession: () => void;
  endSession: () => void;
  tick: () => void;
}

// Read once, when this module first loads (i.e. once per real page
// load/refresh - not on every SPA route change, since the module stays
// loaded across those). If no session was already in progress, start one
// now - this preserves the previous "always running once you land on the
// Live Conversation page" behaviour, just with persistence added.
const existingStartTime = readStoredStartTime();
const initialStartTime = existingStartTime ?? Date.now();
if (existingStartTime === null) {
  writeStoredStartTime(initialStartTime);
}
const initialSessionId = readStoredSessionId();

// Holds the state of the current live session. Once a backend exists,
// startSession()/endSession() are the natural place to call the
// /api/sessions "create" and "close" endpoints alongside the local state.
export const useSessionStore = create<SessionStoreState>((set) => ({
  isSessionActive: true,
  sessionId: initialSessionId,
  startedAt: initialStartTime,
  elapsedSeconds: computeElapsedSeconds(initialStartTime),

  startSession: () => {
    const now = Date.now();
    const id = generateSessionId();
    writeStoredStartTime(now);
    writeStoredSessionId(id);
    set({ isSessionActive: true, sessionId: id, startedAt: now, elapsedSeconds: 0 });
  },

  endSession: () => {
    clearStoredStartTime();
    set({ isSessionActive: false });
  },

  tick: () =>
    set((state) => {
      if (!state.isSessionActive) return state;
      // Recomputed from the real stored timestamp each tick, rather than
      // blindly incrementing by one - keeps the displayed time accurate
      // even if the tab was backgrounded/throttled and missed a beat.
      const startedAt = readStoredStartTime();
      return {
        elapsedSeconds:
          startedAt !== null ? computeElapsedSeconds(startedAt) : state.elapsedSeconds + 1,
      };
    }),
}));
