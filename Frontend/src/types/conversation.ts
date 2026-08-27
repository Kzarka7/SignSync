// Shared between the Dashboard's type picker, Session Setup, and the Live
// Conversation topbar - single source of truth for what a "conversation
// type" is, so all three stay in sync without duplicating the union.
export type ConversationType = 'medical' | 'school' | 'government' | 'other'

export const CONVERSATION_TYPE_LABELS: Record<ConversationType, string> = {
  medical: 'Medical',
  school: 'School',
  government: 'Government',
  other: 'Other',
}
