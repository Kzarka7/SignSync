import { ConfidenceBreakdown, ConfidenceCategory, ConversationMessage } from '../types/message'

export const CONFIDENCE_CATEGORY_LABELS: Record<ConfidenceCategory, string> = {
  handSignRecognition: 'Sign recognition',
  speechRecognition: 'Speech recognition',
  translation: 'Translation',
}

// Averages only the categories actually present on a given message (a
// 'speech' message has no handSignRecognition score, etc.) - this is the
// same "overall" number shown everywhere confidence is collapsed to one
// figure (Live Conversation, the History list).
export function averageConfidence(breakdown: ConfidenceBreakdown): number | undefined {
  const values = Object.values(breakdown).filter((v): v is number => typeof v === 'number')
  if (values.length === 0) return undefined
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length)
}

// Per-category average across every message in a session that has that
// category (a session mixing sign and speech messages will have both
// handSignRecognition and speechRecognition averages, each computed only
// from the messages that actually carry that category). Used for the
// Session Summary confidence container, which sits above the per-message
// transcript rows and reads the same message data - no separate store.
export function averageConfidenceByCategory(messages: ConversationMessage[]): ConfidenceBreakdown {
  const sums: Partial<Record<ConfidenceCategory, number>> = {}
  const counts: Partial<Record<ConfidenceCategory, number>> = {}

  for (const message of messages) {
    const breakdown = message.confidenceBreakdown
    if (!breakdown) continue
    for (const category of Object.keys(breakdown) as ConfidenceCategory[]) {
      const value = breakdown[category]
      if (typeof value !== 'number') continue
      sums[category] = (sums[category] ?? 0) + value
      counts[category] = (counts[category] ?? 0) + 1
    }
  }

  const result: ConfidenceBreakdown = {}
  for (const category of Object.keys(sums) as ConfidenceCategory[]) {
    result[category] = Math.round(sums[category]! / counts[category]!)
  }
  return result
}
