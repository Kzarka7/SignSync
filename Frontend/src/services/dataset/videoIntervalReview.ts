import type { VideoImportMetadata, DatasetFrame } from '../../types/dataset'
import { videoDiagnostics, type ExpectedHands } from './videoDiagnostics'
import { medianFrameStep } from './frameTiming'

export type IntervalReview = NonNullable<VideoImportMetadata['intervalReview']>
export function isFullRecording(start: number, end: number, duration: number) {
  return Math.abs(start) < .000001 && Math.abs(end - duration) < .000001
}
export function intervalReviewMatches(review: IntervalReview | undefined, start: number, end: number, duration: number) {
  return !!review && [start, end, duration].every(Number.isFinite) && start >= 0 && end > start && end <= duration &&
    review.protocol === 'video-interval-review-v1' && Number.isFinite(Date.parse(review.confirmedAt)) &&
    Math.abs(review.startMs - start * 1000) < .001 && Math.abs(review.endMs - end * 1000) < .001 &&
    review.choice === (isFullRecording(start, end, duration) ? 'full-recording' : 'selected-interval')
}
export function confirmInterval(start: number, end: number, duration: number, selectionMethod: 'manual' | 'automatic' = 'manual'): IntervalReview {
  return { protocol: 'video-interval-review-v1', choice: isFullRecording(start, end, duration) ? 'full-recording' : 'selected-interval',
    startMs: start * 1000, endMs: end * 1000, confirmedAt: new Date().toISOString(), selectionMethod }
}

export function intervalFindings(frames: DatasetFrame[], sourceOffset: number, sourceEnd: number, start: number, end: number, expected: ExpectedHands) {
  const ticks = videoDiagnostics(frames)
  const kinds = ['hand-gap', 'body-gap', 'edge'] as const
  const findings: { kind: typeof kinds[number]; label: string; start: number; end: number; location: string }[] = []
  for (const kind of kinds) {
    let first: number | null = null
    const finish = (last: number) => {
      if (first === null) return
      const a = sourceOffset + first / 1000, b = Math.min(sourceEnd, sourceOffset + last / 1000)
      const location = b <= start || a >= end ? 'Outside selected interval' : a >= start && b <= end ? 'Inside selected interval' : 'Crosses interval boundary'
      findings.push({ kind, label: kind === 'edge' ? 'Possible clipping' : kind === 'body-gap' ? 'Weak shoulders' : expected === 'both' ? 'Required hand tracking gap' : 'No hands detected', start: a, end: b, location })
      first = null
    }
    ticks.forEach(tick => {
      const active = kind === 'edge' ? tick.clipped : kind === 'body-gap' ? !tick.shoulders : expected === 'both' ? !(tick.left && tick.right) : !(tick.left || tick.right)
      if (active && first === null) first = tick.timestamp
      if (!active) finish(tick.timestamp)
    })
    if (ticks.length) finish(ticks[ticks.length - 1].timestamp + medianFrameStep(frames))
  }
  return findings.sort((a, b) => a.start - b.start)
}
