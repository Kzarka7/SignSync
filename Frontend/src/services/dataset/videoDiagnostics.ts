import type { DatasetFrame } from '../../types/dataset'
import type { LandmarkPoint } from '../../types/landmarks'
import { medianFrameStep } from './frameTiming'

export type ExpectedHands = 'either' | 'both'
export const detectedHand = (points: LandmarkPoint[] | null | undefined) =>
  Array.isArray(points) && points.length === 21 && points.every(p => p && [p.x, p.y, p.z].every(Number.isFinite))

export function videoDiagnostics(frames: DatasetFrame[]) {
  return frames.map((frame, index) => {
    const left = detectedHand(frame.raw.leftHand), right = detectedHand(frame.raw.rightHand)
    const previous = frames[index - 1]
    const dt = previous ? frame.timestamp - previous.timestamp : 0
    const moving = !!previous && dt > 0 && dt <= 100 && (['leftHand', 'rightHand'] as const).some(side => {
      const a = previous.raw[side], b = frame.raw[side]
      return detectedHand(a) && detectedHand(b) && a!.reduce((sum, point, i) =>
        sum + Math.hypot(point.x - b![i].x, point.y - b![i].y), 0) / 21 / (dt / 1000) > .15
    })
    const clipped = [frame.raw.leftHand, frame.raw.rightHand].some(hand => detectedHand(hand) &&
      hand!.some(p => p.x < .02 || p.x > .98 || p.y < .02 || p.y > .98))
    const shoulders = !!frame.raw.pose && [frame.raw.pose.leftShoulder, frame.raw.pose.rightShoulder]
      .every(p => p && [p.x, p.y, p.z].every(Number.isFinite) && (p.visibility ?? 0) >= .5)
    return { timestamp: frame.timestamp, left, right, moving, clipped, shoulders }
  })
}

// Advisory only: never infer REST, sign correctness, or boundaries from detection loss.
// Include ALL detected activity, including short fragments, plus a 250 ms margin.
export function suggestSignInterval(frames: DatasetFrame[], duration: number) {
  const ticks = videoDiagnostics(frames)
  const visible = ticks.filter(tick => tick.left || tick.right)
  if (!visible.length || !Number.isFinite(duration) || duration <= 0) return null
  const start = Math.max(0, visible[0].timestamp / 1000 - .25)
  const end = Math.min(duration, (visible[visible.length - 1].timestamp + medianFrameStep(frames)) / 1000 + .25)
  return { start: Math.floor(start * 1000) / 1000, end: Math.min(duration, Math.ceil(end * 1000) / 1000),
    activityStartMs: visible[0].timestamp,
    activityEndMs: Math.min(duration * 1000, visible[visible.length - 1].timestamp + medianFrameStep(frames)),
    movingFrames: ticks.filter(tick => tick.moving).length,
    reason: start === 0 && end === duration
      ? 'Hand activity reaches the recording boundaries. Keep the full clip unless visual review identifies surrounding rest.'
      : 'Suggested span covers all detected hand activity with 0.25 seconds of margin. Missing detections may hide part of the sign; inspect both boundaries and adjust before reprocessing.' }
}

export function automaticSignInterval(frames: DatasetFrame[], duration: number) {
  const suggestion = suggestSignInterval(frames, duration)
  if (!suggestion || suggestion.start <= 0 || suggestion.end >= duration || suggestion.activityEndMs - suggestion.activityStartMs < 400 || suggestion.movingFrames < 3) return null
  const visible = videoDiagnostics(frames).filter(tick => tick.left || tick.right)
  // A long internal loss may hide a gesture or separate multiple takes.
  if (visible.some((tick, index) => index > 0 && tick.timestamp - visible[index - 1].timestamp > 750)) return null
  return suggestion
}
