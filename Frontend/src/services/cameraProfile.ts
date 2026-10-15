export type DetectionTiming = {
  handMs: number
  poseMs: number
  overlayMs: number
  resizeMs: number
  otherMs: number
  totalMs: number
  completedAt: number
  presentedFrames?: number
  hidden: boolean
}

// Scalar accumulators only: no landmarks, camera images, or per-frame React state.
export function createCameraProfile() {
  let active = false
  let count = 0
  let first: DetectionTiming | null = null
  let last: DetectionTiming | null = null
  let hiddenFrames = 0
  let totals = { handMs: 0, poseMs: 0, overlayMs: 0, resizeMs: 0, otherMs: 0, totalMs: 0 }
  let maxTotalMs = 0
  let gapMs = 0
  const round = (value: number) => Math.round(value * 100) / 100
  return {
    isActive: () => active,
    start() {
      active = true
      count = hiddenFrames = maxTotalMs = gapMs = 0
      first = last = null
      totals = { handMs: 0, poseMs: 0, overlayMs: 0, resizeMs: 0, otherMs: 0, totalMs: 0 }
    },
    stop() { active = false },
    add(sample: DetectionTiming) {
      if (!active) return
      if (last) gapMs += Math.max(0, sample.completedAt - sample.totalMs - last.completedAt)
      first ??= sample
      last = sample
      count++
      if (sample.hidden) hiddenFrames++
      for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += sample[key]
      maxTotalMs = Math.max(maxTotalMs, sample.totalMs)
    },
    snapshot() {
      const elapsed = first && last ? last.completedAt - first.completedAt : 0
      const presentedDelta = first?.presentedFrames !== undefined && last?.presentedFrames !== undefined
        ? last.presentedFrames - first.presentedFrames : null
      return {
        active, completedCallbacks: count, hiddenFrames,
        completionSpanMs: round(elapsed),
        averageBetweenCallbacksMs: count > 1 ? round(gapMs / (count - 1)) : null,
        processedFps: count > 1 && elapsed > 0 ? round((count - 1) * 1000 / elapsed) : null,
        browserPresentedFps: presentedDelta !== null && presentedDelta >= 0 && elapsed > 0
          ? round(presentedDelta * 1000 / elapsed) : null,
        averageMs: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, count ? round(value / count) : null])),
        maxProcessingMs: count ? round(maxTotalMs) : null,
      }
    },
  }
}
