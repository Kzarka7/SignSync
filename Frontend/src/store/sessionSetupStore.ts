import { create } from 'zustand'
import type { ConversationType } from '../types/conversation'

interface SessionSetupState {
  conversationType: ConversationType
  sessionName: string
  // Gates whether Live Conversation is allowed to start camera detection.
  // Deliberately NOT persisted to localStorage (unlike sessionStore's
  // timer) - a real page refresh should always require going back
  // through Session Setup, so device readiness gets re-confirmed rather
  // than silently trusting a stale check from before the reload.
  isReadyToBegin: boolean
  setConversationType: (type: ConversationType) => void
  setSessionName: (name: string) => void
  beginConversation: () => void
  reset: () => void
}

export const useSessionSetupStore = create<SessionSetupState>((set) => ({
  conversationType: 'medical',
  sessionName: '',
  isReadyToBegin: false,
  setConversationType: (type) => set({ conversationType: type }),
  setSessionName: (name) => set({ sessionName: name }),
  beginConversation: () => set({ isReadyToBegin: true }),
  reset: () => set({ isReadyToBegin: false, sessionName: '' }),
}))
