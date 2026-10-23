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
  if (!Number.isFinite(duration) || duration <= 0 || !frames.length) return null
  const ticks = videoDiagnostics(frames)
  const step = medianFrameStep(frames)
  const reliable = (p: LandmarkPoint | undefined) => !!p && [p.x, p.y, p.z].every(Number.isFinite) && (p.visibility ?? 0) >= .5
  const bodyReference = (frame: DatasetFrame) => {
    const pose = frame.raw.pose
    if (!pose || !reliable(pose.leftShoulder) || !reliable(pose.rightShoulder)) return null
    const scale = Math.hypot(pose.leftShoulder.x - pose.rightShoulder.x, pose.leftShoulder.y - pose.rightShoulder.y)
    const shouldersY = (pose.leftShoulder.y + pose.rightShoulder.y) / 2
    return scale >= .1 ? { scale, lower: shouldersY + scale * .9, elbowLower: shouldersY + scale * .6 } : null
  }
  // Follow arms that enter the signing area. An unseen, unused hand and hips
  // below the crop must not prevent a visible signing arm from returning to rest.
  const activeSides = (['left', 'right'] as const).filter(side => frames.some(frame => {
    const body = bodyReference(frame), wrist = frame.raw.pose?.[`${side}Wrist`], hand = frame.raw[`${side}Hand`]
    return body && ((detectedHand(hand) && hand![0].y < body.lower) || (reliable(wrist) && wrist!.y < body.lower))
  }))
  // An observed, stable lowered-arm posture is evidence of a pause. Detection
  // loss and a stationary raised hand are not: either may be part of a sign.
  const resting = frames.map((frame, index) => {
    const body = bodyReference(frame), previous = frames[index - 1]
    if (!body || !previous || !activeSides.length) return false
    const dt = frame.timestamp - previous.timestamp
    if (dt <= 0 || dt > 100) return false
    return activeSides.every(side => {
      const hand = frame.raw[`${side}Hand`]
      const wrist = frame.raw.pose?.[`${side}Wrist`]
      // Prefer an actual hand observation; otherwise require positive lower-arm
      // pose evidence. Missing detections alone are never a pause.
      if (detectedHand(hand)) return hand![0].y >= body.lower
      if (reliable(wrist) && wrist!.y >= body.lower) return true
      const elbow = frame.raw.pose?.[`${side}Elbow`]
      // In a seated upper-body crop, wrist visibility drops when the hand goes
      // below the image. A confidently lowered elbow plus a wrist estimated
      // below the crop supports that return; an unexplained null hand does not.
      return reliable(elbow) && wrist && [wrist.x, wrist.y, wrist.z].every(Number.isFinite) &&
        elbow!.y >= body.elbowLower && wrist.y >= Math.max(1, body.lower) && wrist.y - elbow!.y >= body.scale * .3
    })
  })
  const pauses: { start: number; end: number }[] = []
  let pauseStart: number | null = null
  for (let i = 0; i <= frames.length; i++) {
    if (i < frames.length && resting[i]) { pauseStart ??= frames[i].timestamp; continue }
    if (pauseStart !== null) {
      const end = Math.min(duration * 1000, frames[i - 1].timestamp + step)
      if (end - pauseStart >= 300 - .01) pauses.push({ start: pauseStart, end })
      pauseStart = null
    }
  }
  for (let i = 1; i < pauses.length; i++) {
    const before = pauses[i - 1], after = pauses[i]
    const activity = ticks.filter(tick => tick.timestamp >= before.end && tick.timestamp < after.start)
    const visible = activity.filter(tick => tick.left || tick.right)
    if (!visible.length) continue
    const activityStartMs = visible[0].timestamp
    const activityEndMs = Math.min(after.start, visible[visible.length - 1].timestamp + step)
    const movingFrames = activity.filter(tick => tick.moving).length
    if (activityEndMs - activityStartMs < 400 || movingFrames < 3 ||
      visible.some((tick, index) => index > 0 && tick.timestamp - visible[index - 1].timestamp > 750)) continue
    return { start: Math.max(before.start, activityStartMs - 250) / 1000,
      end: Math.min(after.end, activityEndMs + 250) / 1000,
      activityStartMs, activityEndMs, movingFrames,
      reason: 'Selected the first usable activity between observed lowered-hand pauses. Preview to confirm one complete sign; repetitions without a lowered-hand pause need manual trimming.' }
  }
  // Never fall back to merging activities separated by an observed pause.
  const visibleTicks = ticks.filter(tick => tick.left || tick.right)
  if (pauses.some(pause => pause.start > visibleTicks[0]?.timestamp && pause.end < visibleTicks[visibleTicks.length - 1]?.timestamp)) return null
  const suggestion = suggestSignInterval(frames, duration)
  if (!suggestion || suggestion.start <= 0 || suggestion.activityEndMs - suggestion.activityStartMs < 400 || suggestion.movingFrames < 3) return null
  // A clip can end while the sign is still held. With an observed preparation
  // pause, remove only the leading idle and preserve the exact source endpoint.
  if (suggestion.end >= duration && !pauses.some(pause => pause.end <= suggestion.activityStartMs)) return null
  const visible = videoDiagnostics(frames).filter(tick => tick.left || tick.right)
  // A long internal loss may hide a gesture or separate multiple takes.
  if (visible.some((tick, index) => index > 0 && tick.timestamp - visible[index - 1].timestamp > 750)) return null
  return suggestion.end >= duration ? { ...suggestion,
    reason: 'Leading idle trimmed; the source ending is preserved. If the sign repeats without a pause, adjust the end manually. Check for a cut-off ending before saving.' } : suggestion
}

// Review still offers preparation/completion trimming when a single performance
// cannot be isolated automatically. Preserve all activity for manual end edits.
export function reviewSignInterval(frames: DatasetFrame[], duration: number) {
  const automatic = automaticSignInterval(frames, duration)
  if (automatic) return automatic
  const suggestion = suggestSignInterval(frames, duration)
  return suggestion ? { ...suggestion,
    reason: 'Suggested outer trim keeps all detected hand activity. If the sign repeats without a clear pause, adjust the end manually to keep one complete performance. Preview both boundaries.' } : null
}
