import type { DatasetFrame, VideoQuality, VideoQualityWindow } from '../../types/dataset'
import type { LandmarkPoint } from '../../types/landmarks'
import { toFeatureVector } from '../landmarks/normalize'
import { detectedHand, type ExpectedHands } from './videoDiagnostics'
import { frameSpan } from './frameTiming'

const finite = (p: LandmarkPoint) => [p.x, p.y, p.z].every(Number.isFinite)
const handVisible = detectedHand

// Non-sign samples may intentionally have no visible hands. Their usability is
// based on body observations; missing-hand presence flags remain unmodified.
export function assessBoundaryVideoQuality(frames: DatasetFrame[], purpose: 'rest' | 'idle_movement', expectedHands: ExpectedHands = 'either', timing?: { endMs: number; fps: number }): VideoQuality {
  const full = assessVideoQuality(frames, expectedHands, timing)
  const step = timing ? 1000 / timing.fps : 50
  let usableMs = 0, longestGapMs = frames[0]?.timestamp ?? 0, gapStart: number | null = null
  const usable = frames.map((frame, index) => {
    const body = frame.raw.pose && [frame.raw.pose.leftShoulder, frame.raw.pose.rightShoulder].every(point => point && finite(point) && (point.visibility ?? 0) >= .5)
    const vector = toFeatureVector(frame.raw)
    const ok = !!body && vector.valid && vector.features.every(Number.isFinite)
    const span = frameSpan(frames, index, step, timing?.endMs)
    if (ok) usableMs += Math.min(span, step * 1.5)
    if (!ok && gapStart === null) gapStart = frame.timestamp
    if (gapStart !== null) longestGapMs = Math.max(longestGapMs, frame.timestamp - gapStart + (ok ? 0 : span))
    if (ok) gapStart = null
    if (index) longestGapMs = Math.max(longestGapMs, frame.timestamp - frames[index - 1].timestamp - step)
    return ok
  })
  const usableFrames = usable.filter(Boolean).length
  const duration = frames.length > 1 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0
  const retake = usableMs < 400 - .01 || duration < 400 - .01
  const findings: string[] = []
  if (retake) findings.push('Too little usable body data: at least 0.4 seconds of usable observations and sampled span are required.')
  if (usableFrames < frames.length * .9) findings.push(`Body tracking is weak in ${frames.length - usableFrames} of ${frames.length} frames.`)
  if (longestGapMs >= 250) findings.push(`Body tracking gap up to ${(longestGapMs / 1000).toFixed(2)} seconds.`)
  if (purpose === 'rest') {
    const visible = expectedHands === 'both' ? full.coverage!.bothHandsFrames : frames.length - full.coverage!.noHandsFrames
    if (visible < frames.length * .9) findings.push('Hand visibility is limited for the selected resting posture; verify the task and framing.')
  }
  findings.push(...full.findings.filter(finding => finding.startsWith('Hands approach')))
  const result = retake ? 'Retake' : findings.length ? 'Review' : 'Pass'
  if (!findings.length) findings.push('Tracking is technically usable. Confirm the selected non-sign task before saving.')
  return { result, findings, usableFrames, totalFrames: frames.length, longestGapMs, coverage: full.coverage }
}

export function validQualityWindow(window: VideoQualityWindow, span: number) {
  return window.protocol === 'gesture-context-v1' && window.basis === 'automatic-hand-activity' &&
    [window.startMs, window.endMs, span].every(Number.isFinite) && window.startMs >= 0 && window.endMs <= span &&
    window.endMs - window.startMs >= 400 && window.startMs <= 350 && span - window.endMs <= 350
}

// Conservative technical checks only. No sign classifier or two-hand requirement.
export function assessVideoQuality(frames: DatasetFrame[], expectedHands: ExpectedHands = 'either', timing?: { endMs: number; fps: number }, window?: VideoQualityWindow): VideoQuality {
  if (window) {
    if (!timing || !validQualityWindow(window, timing.endMs)) throw Error('Invalid gesture/context assessment boundaries.')
    const full = assessVideoQuality(frames, expectedHands, timing)
    const core = frames.filter(frame => frame.timestamp >= window.startMs - .001 && frame.timestamp < window.endMs - .001)
    const gesture = assessVideoQuality(core.map(frame => ({ ...frame, timestamp: Math.max(0, frame.timestamp - window.startMs) })), expectedHands,
      { endMs: window.endMs - window.startMs, fps: timing.fps })
    const findings = gesture.findings.filter(finding => !finding.startsWith('Hands approach') && !finding.startsWith('Tracking is technically usable.') && !finding.startsWith('Hand movement reaches an interval boundary;'))
      .map(finding => finding.startsWith('Tracking is incomplete at the start or end;') ? 'Tracking is incomplete at a gesture assessment boundary; inspect the complete gesture.' : finding)
    // Clipping and motion at the actual saved boundaries remain visible even in context.
    findings.push(...full.findings.filter(finding => finding.startsWith('Hands approach') || finding.startsWith('Hand movement reaches an interval boundary;')))
    const before = frames.filter(frame => frame.timestamp < window.startMs - .001)
    const after = frames.filter(frame => frame.timestamp >= window.endMs - .001)
    const noHandFrames = [...before, ...after].filter(frame => !handVisible(frame.raw.leftHand) && !handVisible(frame.raw.rightHand)).length
    const result = gesture.result === 'Retake' ? 'Retake' : findings.length ? 'Review' : 'Pass'
    if (!findings.length) findings.push('Gesture tracking is technically usable. Review the complete sign and intended label before saving.')
    return { ...full, result, findings, longestGapMs: gesture.longestGapMs,
      gesture: { startMs: window.startMs, endMs: window.endMs, usableFrames: gesture.usableFrames, totalFrames: gesture.totalFrames, longestGapMs: gesture.longestGapMs },
      context: { beforeFrames: before.length, afterFrames: after.length, noHandFrames,
        findings: ['Preparation/completion margins are shown separately, not classified as idle. Inspect these boundaries for hidden gesture movement.',
          `${noHandFrames} context frames have no hand detections; they are retained in the saved sample.`] } }
  }
  const step = timing ? 1000 / timing.fps : 50
  const span = (i: number) => timing ? frameSpan(frames, i, step, timing.endMs) : 50
  const coverage: NonNullable<VideoQuality['coverage']> = {
    leftHandFrames: 0, rightHandFrames: 0, bothHandsFrames: 0, noHandsFrames: 0, shoulderFrames: 0, noHandIntervalsMs: [],
  }
  let noHandsStart: number | null = null
  let usableFrames = 0, usableMs = 0, gapStart: number | null = null, longestGapMs = 0, clipped = 0
  if (timing && frames.length) longestGapMs = frames[0].timestamp
  const usable = frames.map(({ raw, timestamp }, index) => {
    const body = raw.pose && [raw.pose.leftShoulder, raw.pose.rightShoulder].every(p => p && finite(p) && (p.visibility ?? 0) >= .5)
    const left = !!handVisible(raw.leftHand), right = !!handVisible(raw.rightHand)
    if (left) coverage.leftHandFrames++
    if (right) coverage.rightHandFrames++
    if (left && right) coverage.bothHandsFrames++
    if (body) coverage.shoulderFrames++
    if (!left && !right) { coverage.noHandsFrames++; if (noHandsStart === null) noHandsStart = timestamp }
    else if (noHandsStart !== null) { coverage.noHandIntervalsMs.push({ start: noHandsStart, end: timestamp }); noHandsStart = null }
    const vector = toFeatureVector(raw)
    const ok = !!body && vector.valid && vector.features.every(Number.isFinite) && !!(handVisible(raw.leftHand) || handVisible(raw.rightHand))
    if (ok) { usableFrames++; usableMs += Math.min(span(index), step * 1.5) }
    if (!ok && gapStart === null) gapStart = timestamp
    if (gapStart !== null) longestGapMs = Math.max(longestGapMs, timestamp - gapStart + (ok ? 0 : span(index)))
    if (timing && index) longestGapMs = Math.max(longestGapMs, timestamp - frames[index - 1].timestamp - step)
    if (ok) gapStart = null
    if ([...(raw.leftHand ?? []), ...(raw.rightHand ?? [])].some(p => p.x < .02 || p.x > .98 || p.y < .02 || p.y > .98)) clipped++
    return ok
  })
  if (noHandsStart !== null) coverage.noHandIntervalsMs.push({ start: noHandsStart, end: frames[frames.length - 1].timestamp + span(frames.length - 1) })
  const findings: string[] = []
  if (expectedHands === 'both' && coverage.bothHandsFrames < frames.length * .9) findings.push(`Both hands are expected for this take, but both are detected in only ${coverage.bothHandsFrames} of ${frames.length} frames. Inspect missing-hand periods during the sign.`)
  for (const side of ['leftHand', 'rightHand'] as const) {
    const visible = frames.map(frame => !!handVisible(frame.raw[side]))
    const first = visible.indexOf(true), last = visible.lastIndexOf(true)
    let gap = 0, longest = 0
    for (let i = first; i >= 0 && i <= last; i++) {
      gap = visible[i] ? 0 : gap + span(i)
      longest = Math.max(longest, gap)
    }
    if (longest >= 250) findings.push(`${side === 'leftHand' ? 'Left' : 'Right'} hand disappears between detections for up to ${(longest / 1000).toFixed(2)} seconds.`)
    longestGapMs = Math.max(longestGapMs, longest)
  }
  const duration = frames.length > 1 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0
  const retake = (timing ? usableMs < 400 - .01 : usableFrames < 8) || duration < 400 - .01
  if (retake) findings.push(timing ? 'Too little usable hand and body data: at least 0.4 seconds of usable observations and sampled span are required.' : 'Too little usable hand and body data: at least 8 usable frames and 0.4 seconds are required.')
  if (usableFrames < frames.length * .9) findings.push(`Hand or shoulder tracking is weak in ${frames.length - usableFrames} of ${frames.length} frames.`)
  if (longestGapMs >= 250) findings.push(`Tracking gap up to ${(longestGapMs / 1000).toFixed(2)} seconds.`)
  if (clipped) findings.push(`Hands approach the image edge in ${clipped} frames; check for clipped fingers or movement.`)
  if (frames.length && (!usable[0] || !usable[usable.length - 1])) findings.push('Tracking is incomplete at the start or end; check that the whole sign is covered.')
  // Motion near either endpoint can indicate a cut gesture. A static hand is allowed.
  const moving = (a: DatasetFrame, b: DatasetFrame) => (['leftHand', 'rightHand'] as const).some(side => {
    const x = a.raw[side]?.[0], y = b.raw[side]?.[0]
    return x && y && Math.hypot(x.x - y.x, x.y - y.y) > .04
  })
  const early = timing ? frames.find(frame => frame.timestamp >= frames[0]?.timestamp + 100) : frames[2]
  const late = timing ? [...frames].reverse().find(frame => frame.timestamp <= frames[frames.length - 1].timestamp - 100) : frames[frames.length - 3]
  if (frames.length >= 6 && early && late && (moving(frames[0], early) || moving(late, frames[frames.length - 1]))) findings.push('Hand movement reaches an interval boundary; check for a cut-off beginning or ending.')
  if (duration > 8000) findings.push('Long take: check for setup movement, repeated signs, or extra movement and trim if needed.')
  const result = retake ? 'Retake' : findings.length ? 'Review' : 'Pass'
  if (!findings.length) findings.push('Tracking is technically usable. Review the complete sign and intended label before saving.')
  return { result, findings, usableFrames, totalFrames: frames.length, longestGapMs, coverage }
}
