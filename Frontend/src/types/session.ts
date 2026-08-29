import type { ConversationType } from './conversation'
import type { ConversationMessage } from './message'

// Mirrors the shape the future FastAPI `/sessions` endpoints will return.
export interface ConversationSession {
  id: string
  title: string
  location: string
  startedAt: string // ISO 8601
  durationMinutes: number
  messageCount: number
  // Optional - real (non-mock) sessions may not have any messages with a
  // confidence score yet. Absent, not zero, when there's nothing to show.
  avgConfidence?: number // 0-100
}

// A completed Live Conversation session, as persisted by
// sessionHistoryStorage. This is the full record (transcript included);
// ConversationSession above is just the summary shape used for list rows.
export interface SavedSession {
  id: string
  sessionName: string
  conversationType: ConversationType
  startedAt: string // ISO 8601
  endedAt: string // ISO 8601
  durationSeconds: number
  messages: ConversationMessage[]
  // Quick phrases actually used during the session. Empty when phrase
  // usage isn't tracked yet - never backfilled with guesses.
  phrasesUsed: string[]
  // Average of each message's `confidence`, when at least one message has
  // one. Null - not 0 - when there's nothing to average.
  avgConfidence: number | null
}
