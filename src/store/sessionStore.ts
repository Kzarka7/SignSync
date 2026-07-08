import { create } from 'zustand'

interface SessionStoreState {
  isSessionActive: boolean
  elapsedSeconds: number
  startSession: () => void
  endSession: () => void
  tick: () => void
}

// Holds the state of the current live session. Once a backend exists,
// startSession()/endSession() are the natural place to call the
// /api/sessions "create" and "close" endpoints alongside the local state.
export const useSessionStore = create<SessionStoreState>((set) => ({
  isSessionActive: true,
  elapsedSeconds: 4 * 60 + 12,
  startSession: () => set({ isSessionActive: true, elapsedSeconds: 0 }),
  endSession: () => set({ isSessionActive: false }),
  tick: () => set((state) => ({ elapsedSeconds: state.elapsedSeconds + 1 })),
}))
