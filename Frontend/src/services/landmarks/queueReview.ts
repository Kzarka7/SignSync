export function mostPredictedSign(rows: readonly { prediction: { label: string } | null }[]) {
  const counts = new Map<string, number>()
  for (const { prediction } of rows) {
    if (prediction?.label) counts.set(prediction.label, (counts.get(prediction.label) ?? 0) + 1)
  }
  let label: string | undefined, maximum = 0
  // Map insertion order gives tied labels a stable first-seen winner.
  for (const [candidate, count] of counts) {
    if (count > maximum) { label = candidate; maximum = count }
  }
  return label
}

export function queueSignSummary(state: {
  transcript: readonly { label: string }[]
  rows: readonly { prediction: { label: string } | null }[]
} | null | undefined, display: (label: string) => string) {
  const transcript = state?.transcript ?? []
  const rows = state?.rows ?? []
  const confirmed = transcript.length > 0
  const predicted = confirmed ? undefined : mostPredictedSign(rows)
  const labels = confirmed ? transcript.map(entry => entry.label) : predicted ? [predicted] : []
  const counts = new Map<string, number>()
  for (const { prediction } of rows) {
    if (prediction?.label) counts.set(prediction.label, (counts.get(prediction.label) ?? 0) + 1)
  }
  return {
    displayedText: labels.map(display).join(' → ') || '—',
    labels, confirmed,
    source: confirmed ? 'confirmed-transcript' : predicted ? 'prediction-window-vote' : 'none',
    predictionWindowCounts: [...counts].map(([label, count]) => ({ label, count })),
    totalPredictionWindows: [...counts.values()].reduce((sum, count) => sum + count, 0),
  }
}
