import { create } from "zustand";

// Persists the session's start time (not the whole store) to localStorage,
// so refreshing the Live Conversation page - or briefly navigating away
// and back - doesn't reset the running timer back to zero.
const STORAGE_KEY = "daloy:session-started-at";

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

function computeElapsedSeconds(startedAt: number): number {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

interface SessionStoreState {
  isSessionActive: boolean;
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

// Holds the state of the current live session. Once a backend exists,
// startSession()/endSession() are the natural place to call the
// /api/sessions "create" and "close" endpoints alongside the local state.
export const useSessionStore = create<SessionStoreState>((set) => ({
  isSessionActive: true,
  elapsedSeconds: computeElapsedSeconds(initialStartTime),

  startSession: () => {
    const now = Date.now();
    writeStoredStartTime(now);
    set({ isSessionActive: true, elapsedSeconds: 0 });
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
