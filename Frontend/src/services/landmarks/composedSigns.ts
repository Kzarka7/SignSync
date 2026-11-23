// Signs whose gesture is two vocabulary signs made back to back. The combined
// model never outputs these labels: PARENTS uses the FATHER and MOTHER gestures,
// so a PARENTS class would compete with (and add noise to) both single signs.
// Instead, two confirmed parts in either order become the composed sign.
export const COMPOSED_SIGNS = [{ label: 'PARENTS', parts: ['FATHER', 'MOTHER'] }] as const

// Longest time between the two confirmations. The second part's confirmation
// lands about one sign duration after the first (PARENTS clips: ~2.1 s median,
// ~2.9 s p90 for both parts together), plus the Lab's confirmation delay.
export const COMPOSITION_MAX_GAP_MS = 3000

export type ComposableEntry = { label: string; score: number; decisionMs: number; requestId: string
  composedFrom?: { label: string; score: number; decisionMs: number; requestId: string }[] }

/**
 * Append a confirmed sign. When it completes a composed sign with the entry
 * right before it, that entry is replaced by the composed sign, so the two
 * confirmed parts are no longer shown on their own. Returns true when composed.
 */
export function appendComposed<T extends ComposableEntry>(transcript: T[], entry: T,
  maxGapMs = COMPOSITION_MAX_GAP_MS): boolean {
  const previous = transcript[transcript.length - 1]
  const composed = previous && !previous.composedFrom && previous.label !== entry.label
    && entry.decisionMs - previous.decisionMs <= maxGapMs
    && COMPOSED_SIGNS.find(sign => (sign.parts as readonly string[]).includes(previous.label)
      && (sign.parts as readonly string[]).includes(entry.label))
  if (!composed) {
    transcript.push(entry)
    return false
  }
  const parts = [previous, entry].map(({ label, score, decisionMs, requestId }) => ({ label, score, decisionMs, requestId }))
  transcript[transcript.length - 1] = { ...entry, label: composed.label, score: Math.min(previous.score, entry.score),
    composedFrom: parts }
  return true
}
