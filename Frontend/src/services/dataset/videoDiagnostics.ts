import type { DatasetFrame } from '../../types/dataset'
import type { LandmarkPoint } from '../../types/landmarks'
import { medianFrameStep } from './frameTiming'

export type ExpectedHands = 'either' | 'both'
export const detectedHand = (points: LandmarkPoint[] | null | undefined) =>
  Array.isArray(points) && points.length === 21 && points.every(p => p && [p.x, p.y, p.z].every(Number.isFinite))

const handDisplacement = (a: LandmarkPoint[], b: LandmarkPoint[]) =>
  a.reduce((sum, point, i) => sum + Math.hypot(point.x - b[i].x, point.y - b[i].y), 0) / 21

export function videoDiagnostics(frames: DatasetFrame[]) {
  return frames.map((frame, index) => {
    const left = detectedHand(frame.raw.leftHand), right = detectedHand(frame.raw.rightHand)
    const previous = frames[index - 1]
    const dt = previous ? frame.timestamp - previous.timestamp : 0
    const moving = !!previous && dt > 0 && dt <= 100 && (['leftHand', 'rightHand'] as const).some(side => {
      const a = previous.raw[side], b = frame.raw[side]
      return detectedHand(a) && detectedHand(b) && handDisplacement(a!, b!) / (dt / 1000) > .15
    })
    const clipped = [frame.raw.leftHand, frame.raw.rightHand].some(hand => detectedHand(hand) &&
      hand!.some(p => p.x < .02 || p.x > .98 || p.y < .02 || p.y > .98))
    const shoulders = !!frame.raw.pose && [frame.raw.pose.leftShoulder, frame.raw.pose.rightShoulder]
      .every(p => p && [p.x, p.y, p.z].every(Number.isFinite) && (p.visibility ?? 0) >= .5)
    return { timestamp: frame.timestamp, left, right, moving, clipped, shoulders }
  })
}

// Advisory only: never infer REST, sign correctness, or boundaries from detection loss.
// Keep two processed-frame intervals of clearance, capped at 100 ms so a
// low-rate recording cannot introduce a long unusable lead-in or tail.
const trimClearanceMs = (frames: DatasetFrame[]) => Math.min(100, medianFrameStep(frames) * 2)

// Include ALL detected activity, including short fragments, plus brief clearance.
export function suggestSignInterval(frames: DatasetFrame[], duration: number) {
  const ticks = videoDiagnostics(frames)
  const visible = ticks.filter(tick => tick.left || tick.right)
  if (!visible.length || !Number.isFinite(duration) || duration <= 0) return null
  const clearance = trimClearanceMs(frames)
  const start = Math.max(0, (visible[0].timestamp - clearance) / 1000)
  const end = Math.min(duration, (visible[visible.length - 1].timestamp + medianFrameStep(frames) + clearance) / 1000)
  return { start: Math.floor(start * 1000) / 1000, end: Math.min(duration, Math.ceil(end * 1000) / 1000),
    activityStartMs: visible[0].timestamp,
    activityEndMs: Math.min(duration * 1000, visible[visible.length - 1].timestamp + medianFrameStep(frames)),
    movingFrames: ticks.filter(tick => tick.moving).length,
    reason: start === 0 && end === duration
      ? 'Hand activity reaches the recording boundaries. Keep the full clip unless visual review identifies surrounding rest.'
      : 'Suggested span covers all detected hand activity with about two frames of clearance on each side (up to 0.10 seconds). Preview both boundaries before saving.' }
}

type SignInterval = NonNullable<ReturnType<typeof suggestSignInterval>>
export type SignIntervalAnalysis = {
  automatic: SignInterval | null
  suggestion: SignInterval | null
  code: 'automatic' | 'invalid-recording' | 'no-hands' | 'separate-activities' | 'short-activity' |
    'insufficient-motion' | 'tracking-gap' | 'no-trim' | 'unconfirmed-preparation' | 'unconfirmed-completion'
  reason: string
}

// Shared by the processing queue and preview. The conservative candidate keeps
// the original confidence checks; the outer suggestion can be applied for review
// without granting gesture/context quality exemptions.
export function analyzeSignInterval(frames: DatasetFrame[], duration: number): SignIntervalAnalysis {
  const suggestion = suggestSignInterval(frames, duration)
  const defer = (code: SignIntervalAnalysis['code'], reason: string): SignIntervalAnalysis =>
    ({ automatic: null, suggestion, code, reason })
  const accept = (interval: SignInterval): SignIntervalAnalysis =>
    ({ automatic: interval, suggestion: interval, code: 'automatic', reason: interval.reason })
  if (!Number.isFinite(duration) || duration <= 0 || !frames.length)
    return defer('invalid-recording', 'The recording has no usable timing or frames.')
  if (!suggestion) return defer('no-hands', 'No hand landmarks were detected. Missing detections alone cannot establish sign boundaries.')
  const ticks = videoDiagnostics(frames)
  const step = medianFrameStep(frames)
  const clearance = trimClearanceMs(frames)
  const { pauses } = observedRest(frames, duration, step)
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
    return accept({ start: Math.max(before.start, activityStartMs - clearance) / 1000,
      end: Math.min(after.end, activityEndMs + clearance) / 1000,
      activityStartMs, activityEndMs, movingFrames,
      reason: 'Selected the first usable activity between observed lowered-hand pauses. Preview to confirm one complete sign; repetitions without a lowered-hand pause need manual trimming.' })
  }
  // Never fall back to merging activities separated by an observed pause.
  const visibleTicks = ticks.filter(tick => tick.left || tick.right)
  if (pauses.some(pause => pause.start > visibleTicks[0]?.timestamp && pause.end < visibleTicks[visibleTicks.length - 1]?.timestamp))
    return defer('separate-activities', 'An observed pause separates activities, but no complete usable performance could be isolated. Choose one performance manually.')
  if (suggestion.activityEndMs - suggestion.activityStartMs < 400)
    return defer('short-activity', 'Detected activity spans less than 0.4 seconds.')
  if (suggestion.movingFrames < 3)
    return defer('insufficient-motion', 'Fewer than three moving hand observations were found. A held pose alone does not establish a complete sign.')
  const trimStart = suggestion.start > 0, trimEnd = suggestion.end < duration
  if (!trimStart && !trimEnd)
    return defer('no-trim', 'Detected hand activity and its margins reach both source boundaries. The full recording is retained.')
  // A clip can end while the sign is still held. With an observed preparation
  // pause, remove only the leading idle and preserve the exact source endpoint.
  if (!trimEnd && !pauses.some(pause => pause.end <= suggestion.activityStartMs))
    return defer('unconfirmed-preparation', 'A suggested start was found, but no sustained lowered-hand preparation pause was observed. The source ending is preserved; review the suggested start manually.')
  // Symmetric end-only trimming requires positive completion evidence. Preserve
  // the source beginning; never treat missing hands as an observed return to rest.
  // With irregular cadence the median frame span can overlap the first rest
  // observation. Compare real observation times, not that estimated span.
  if (!trimStart && !pauses.some(pause => pause.start > visibleTicks[visibleTicks.length - 1].timestamp && pause.end >= suggestion.activityEndMs))
    return defer('unconfirmed-completion', 'A suggested end was found, but no sustained lowered-hand completion pause was observed. Review the suggested end manually.')
  // A long internal loss may hide a gesture or separate multiple takes.
  if (visibleTicks.some((tick, index) => index > 0 && tick.timestamp - visibleTicks[index - 1].timestamp > 750))
    return defer('tracking-gap', 'An internal hand-tracking gap exceeds 0.75 seconds and may hide part of the sign. Review the interval manually.')
  return accept(!trimEnd ? { ...suggestion,
    reason: 'Leading idle trimmed; the source ending is preserved. If the sign repeats without a pause, adjust the end manually. Check for a cut-off ending before saving.' }
    : !trimStart ? { ...suggestion,
      reason: 'Trailing idle trimmed after an observed lowered-hand completion pause; the source beginning is preserved. Check for a cut-off beginning before saving.' } : suggestion)
}

function observedRest(frames: DatasetFrame[], duration: number, step: number, moving?: boolean[]) {
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
    if (!body || !previous || !activeSides.length || moving?.[index]) return false
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
  return { resting, pauses }
}

export function stationarySignInterval(frames: DatasetFrame[], duration: number) {
  const ticks = videoDiagnostics(frames)
  const step = medianFrameStep(frames)
  const trackedSpan = (['left', 'right'] as const).flatMap(side => {
    const spans: { first: number; last: number }[] = []
    for (let i = 0; i < ticks.length; i++) {
      if (!ticks[i][side]) continue
      const span = spans[spans.length - 1]
      const gap = span ? ticks[i].timestamp - ticks[span.last].timestamp : 0
      if (span && span.last === i - 1 && gap > 0 && gap <= 100) span.last = i
      else spans.push({ first: i, last: i })
    }
    // A lone detection at the image edge can precede the hand entering fully.
    // Keep separate sustained tracks ambiguous, including gaps within a hold.
    const sustained = spans.filter(span => span.first !== span.last)
    return sustained.length === 1 ? sustained : []
  }).sort((a, b) => (b.last - b.first) - (a.last - a.first))[0]
  if (trackedSpan) {
    // Allow a hand to enter or leave the image. Only split movement after a
    // sustained quiet interval, since one entry can contain several short lulls.
    const bursts: { first: number; last: number }[] = []
    for (let i = trackedSpan.first + 1; i <= trackedSpan.last; i++) {
      if (!ticks[i].moving) continue
      const burst = bursts[bursts.length - 1]
      if (burst && ticks[i].timestamp - ticks[burst.last].timestamp < 250) burst.last = i
      else bursts.push({ first: i, last: i })
    }
    if (bursts.length === 0 || bursts.length > 2) return null
    const lastEntryFrame = ticks[bursts[0].last].timestamp / 1000
    const next = bursts[0].last < trackedSpan.last ? ticks[bursts[0].last + 1] : undefined
    const trackedEnd = trackedSpan.last === ticks.length - 1 ? duration
      : Math.min(ticks[trackedSpan.last + 1].timestamp, ticks[trackedSpan.last].timestamp + step) / 1000
    const end = bursts.length === 2 ? ticks[bursts[1].first].timestamp / 1000 : trackedEnd
    // If movement runs to the final observation, a trim with no frames is a Retake.
    const holdStart = next ? next.timestamp / 1000 : (lastEntryFrame + end) / 2
    return holdStart < end ? { start: holdStart, end } : null
  }
  const { resting, pauses } = observedRest(frames, duration, step, ticks.map(tick => tick.moving))
  const states = ticks.map((tick, index) => {
    const previous = ticks[index - 1]
    const gap = tick.timestamp - previous?.timestamp
    if (resting[index] || !previous || !(gap > 0 && gap <= 100) ||
      !previous.shoulders || !tick.shoulders || !(tick.left || tick.right) ||
      previous.left !== tick.left || previous.right !== tick.right) return 'unknown'
    return tick.moving ? 'motion' : 'hold'
  })
  let candidate: { start: number; end: number } | null = null
  let j = 0
  for (let i = 1; i < pauses.length; i++) {
    const before = pauses[i - 1], after = pauses[i]
    let movingFrames = 0
    for (; j < ticks.length && ticks[j].timestamp < after.start; j++) {
      if (ticks[j].timestamp < before.end) continue
      if (states[j] === 'motion') { movingFrames++; continue }
      const entryMotion = movingFrames
      movingFrames = 0
      if (states[j] !== 'hold') continue
      const first = j
      while (states[j + 1] === 'hold' && ticks[j + 1].timestamp < after.start) j++
      // Use the first still observation and exclude the first moving observation.
      if (entryMotion < 2 || states[j + 1] !== 'motion' || states[j + 2] !== 'motion' ||
        ticks[j + 2].timestamp >= after.start) continue
      // Slow drift can stay below the per-frame motion threshold.
      const drifts = frames.slice(first + 1, j + 1).some(frame =>
        (['leftHand', 'rightHand'] as const).some(side => {
          const anchor = frames[first].raw[side], hand = frame.raw[side]
          return detectedHand(anchor) && detectedHand(hand) && handDisplacement(anchor!, hand!) > .025
        }))
      if (drifts) continue
      if (candidate) return null
      candidate = { start: ticks[first].timestamp / 1000, end: ticks[j + 1].timestamp / 1000 }
    }
  }
  return candidate
}

export function automaticSignInterval(frames: DatasetFrame[], duration: number) {
  return analyzeSignInterval(frames, duration).automatic
}

// Review still offers preparation/completion trimming when a single performance
// cannot be isolated automatically. Preserve all activity for manual end edits.
export function reviewSignInterval(frames: DatasetFrame[], duration: number) {
  const analysis = analyzeSignInterval(frames, duration)
  if (analysis.automatic) return analysis.automatic
  return analysis.suggestion ? { ...analysis.suggestion,
    reason: 'Suggested outer trim keeps all detected hand activity. If the sign repeats without a clear pause, adjust the end manually to keep one complete performance. Preview both boundaries.' } : null
}
