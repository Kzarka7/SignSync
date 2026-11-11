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
  mediaTime?: number
  handsDetected?: boolean
  handCount?: number
  singleHandSide?: 'Left' | 'Right'
  frameCopyMs?: number
  overlayPaintOpportunityMs?: number
}

export function createRecentCameraTiming() {
  const samples: DetectionTiming[] = []
  const maxGapMs = 1000
  return {
    clear() { samples.length = 0 },
    add(sample: DetectionTiming) {
      const last = samples[samples.length - 1]
      if (sample.hidden || (last && sample.completedAt - last.completedAt > maxGapMs)) samples.length = 0
      if (sample.hidden) return
      if (samples.length === 48) samples.shift()
      samples.push(sample)
    },
    snapshot(now: number) {
      const last = samples[samples.length - 1]
      if (!last || now - last.completedAt > maxGapMs) return null
      const first = samples[0]
      const elapsed = last.completedAt - first.completedAt
      const presented = first.presentedFrames !== undefined && last.presentedFrames !== undefined
        ? last.presentedFrames - first.presentedFrames : null
      return { latest: last, samples: samples.slice(),
        processedFps: elapsed > 0 ? (samples.length - 1) * 1000 / elapsed : null,
        presentedFps: elapsed > 0 && presented !== null && presented >= 0 ? presented * 1000 / elapsed : null }
    },
  }
}

// Scalar accumulators only: no landmarks, camera images, or per-frame React state.
export function createCameraProfile() {
  let active = false
  let detailed = false
  const samples: DetectionTiming[] = []
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
    start(includeDetails = false) {
      active = true
      detailed = includeDetails
      samples.length = 0
      count = hiddenFrames = maxTotalMs = gapMs = 0
      first = last = null
      totals = { handMs: 0, poseMs: 0, overlayMs: 0, resizeMs: 0, otherMs: 0, totalMs: 0 }
    },
    stop() { active = false },
    add(sample: DetectionTiming) {
      if (!active) return
      if (detailed && samples.length < 4096) samples.push(sample)
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
        ...(detailed && { benchmark: summarizeBenchmark(samples, round) }),
      }
    },
  }
}

function summarizeBenchmark(samples: DetectionTiming[], round: (value: number) => number) {
  function percentiles(values: number[]) {
    if (!values.length) return null
    values.sort((a, b) => a - b)
    const mid = Math.floor(values.length / 2)
    const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
    return { count: values.length, median: round(median), p95: round(values[Math.ceil(values.length * .95) - 1]) }
  }

  let previousMediaTime: number | undefined
  let previousHandCompletion: number | undefined
  const gaps: number[] = []
  let freshHandUpdates = 0
  let freshHandIntervals = 0
  for (const [index, sample] of samples.entries()) {
    const distinct = sample.mediaTime !== undefined && sample.mediaTime !== previousMediaTime
    previousMediaTime = sample.mediaTime
    if (!distinct || !sample.handsDetected) continue
    freshHandUpdates++
    if (index > 0) freshHandIntervals++
    if (previousHandCompletion !== undefined) gaps.push(sample.completedAt - previousHandCompletion)
    previousHandCompletion = sample.completedAt
  }
  const span = samples.length > 1 ? samples[samples.length - 1].completedAt - samples[0].completedAt : 0
  return {
    timedSamples: samples.length,
    freshHandUpdates,
    freshHandFps: span > 0 ? round(freshHandIntervals * 1000 / span) : null,
    freshHandUpdateGapMs: percentiles(gaps),
    handMs: percentiles(samples.filter(sample => sample.handMs > 0).map(sample => sample.handMs)),
    poseMs: percentiles(samples.filter(sample => sample.poseMs > 0).map(sample => sample.poseMs)),
    callbackToLandmarksMs: percentiles(samples.map(sample => sample.totalMs)),
    frameCopyMs: percentiles(samples.map(sample => sample.frameCopyMs ?? 0)),
    callbackToOverlayPaintOpportunityMs: percentiles(samples.flatMap(sample =>
      sample.overlayPaintOpportunityMs === undefined ? [] : [sample.overlayPaintOpportunityMs])),
  }
}
