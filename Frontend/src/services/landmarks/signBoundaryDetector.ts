import type { LandmarkFrameSample, LandmarkPoint } from '../../types/landmarks'
import { normalizeFrame } from './normalize'

// Shared by offline replay and the opt-in P4 continuous camera test.
// Provisional motion/rest thresholds; evaluate them during live testing.
export const BOUNDARY_DEFAULTS = {
  calibrationMs: 1000, preRollMs: 350, startMs: 150, endMs: 750,
  postRollMs: 150, rearmMs: 500, maxGapMs: 300, lostTrackingMs: 400,
  maxCaptureMs: 8000, startSpeed: 0.35, quietSpeed: 0.15, restDistance: 0.18,
}
export type BoundarySettings = typeof BOUNDARY_DEFAULTS
type Point = Pick<LandmarkPoint, 'x' | 'y'>
type Observation = { timestamp: number; wrists: Point[]; hands: (Point[] | null)[] }
export type BoundaryEvent = {
  type: 'segment' | 'discard'
  reason: string
  startMs: number
  endMs: number
  decisionMs: number
  frameCount: number
  validFraction: number
  handPresenceFraction: number
}

function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y) }
function observation(frame: LandmarkFrameSample): Observation | null {
  const n = normalizeFrame(frame)
  if (!n) return null
  const wrists = [n.pose.leftWrist, n.pose.rightWrist]
  const hands = [n.leftHand, n.rightHand]
  if (hands.some(h => h && h.length !== 21)) return null
  if ([...wrists, n.pose.leftShoulder, n.pose.rightShoulder, ...hands.flatMap(h => h ?? [])]
    .some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null
  if ([n.pose.leftShoulder, n.pose.rightShoulder].some(p => (p.visibility ?? 1) < 0.5)) return null
  return { timestamp: frame.timestamp, wrists, hands }
}
function motion(a: Observation, b: Observation) {
  const dt = (b.timestamp - a.timestamp) / 1000
  const changes = a.wrists.map((p, i) => distance(p, b.wrists[i]))
  for (let side = 0; side < 2; side++) {
    const ah = a.hands[side], bh = b.hands[side]
    if (ah && bh) changes.push(ah.reduce((sum, p, i) => sum + distance(p, bh[i]), 0) / 21)
  }
  return Math.max(...changes) / dt
}
function atRest(current: Observation, reference: Observation, threshold: number) {
  if (current.wrists.some((p, i) => distance(p, reference.wrists[i]) > threshold)) return false
  for (let side = 0; side < 2; side++) {
    const a = current.hands[side], b = reference.hands[side]
    // A previously unseen hand entering the frame requires movement evidence,
    // but does not itself establish a different sign or a tracking error.
    if (a && b && a.reduce((sum, p, i) => sum + distance(p, b[i]), 0) / 21 > threshold) return false
  }
  return true
}

export function createSignBoundaryDetector(overrides: Partial<BoundarySettings> = {}, options: { noHandsAsRest?: boolean } = {}) {
  const settings = { ...BOUNDARY_DEFAULTS, ...overrides }
  if (Object.values(settings).some(v => !Number.isFinite(v) || v <= 0) || settings.quietSpeed >= settings.startSpeed) {
    throw new Error('Boundary settings must be positive; quietSpeed must be below startSpeed.')
  }
  let phase: 'calibrating' | 'ready' | 'possible-start' | 'recording' | 'rearming' = 'calibrating'
  let previous: Observation | null = null, reference: Observation | null = null
  let lastTimestamp = -Infinity, calmSince: number | null = null, movingSince: number | null = null
  let lostSince: number | null = null, restSince: number | null = null
  let buffer: LandmarkFrameSample[] = [], capture: LandmarkFrameSample[] = []
  let armedHands = [false, false]

  function reset() {
    phase = 'calibrating'; previous = reference = null
    calmSince = movingSince = lostSince = restSince = null
    buffer = []; capture = []; armedHands = [false, false]
  }
  function event(type: BoundaryEvent['type'], reason: string, frames: LandmarkFrameSample[], now: number): BoundaryEvent {
    const valid = frames.map(observation)
    return { type, reason, startMs: frames[0]?.timestamp ?? now,
      endMs: frames[frames.length - 1]?.timestamp ?? now, decisionMs: now, frameCount: frames.length,
      validFraction: valid.filter(Boolean).length / Math.max(frames.length, 1),
      handPresenceFraction: valid.filter(f => f?.hands.some(Boolean)).length / Math.max(frames.length, 1) }
  }
  function discard(reason: string, now: number) {
    const e = event('discard', reason, capture, now)
    reset()
    return [e]
  }

  return {
    settings,
    get phase() { return phase },
    push(frame: LandmarkFrameSample): BoundaryEvent[] {
      const now = frame.timestamp
      if (!Number.isFinite(now) || now <= lastTimestamp) throw new Error('Frame timestamps must increase strictly.')
      const gap = now - lastTimestamp
      lastTimestamp = now
      if (gap > settings.maxGapMs && Number.isFinite(gap)) {
        if (phase === 'recording') return discard('frame-gap', now)
        reset()
      }
      const current = observation(frame)
      buffer.push(frame)
      buffer = buffer.filter(f => now - f.timestamp <= settings.preRollMs + settings.startMs)
      if (phase === 'recording') capture.push(frame)
      if (!current) {
        previous = null
        if (phase === 'recording') {
          lostSince ??= now
          if (now - lostSince >= settings.lostTrackingMs) return discard('pose-tracking-lost', now)
        } else { reset() }
        return []
      }
      const speed = previous ? motion(previous, current) : null
      previous = current
      if (phase === 'recording' && speed === null && lostSince !== null && now - lostSince >= settings.lostTrackingMs) {
        return discard('tracking-interruption', now)
      }
      const quiet = speed !== null && speed <= settings.quietSpeed
      const noHands = options.noHandsAsRest && !current.hands.some(Boolean)
      if (phase === 'calibrating') {
        if (noHands) {
          reference = current; phase = 'ready'
          return []
        }
        if (!quiet) calmSince = null
        else {
          calmSince ??= now
          if (now - calmSince >= settings.calibrationMs) { reference = current; phase = 'ready' }
        }
        return []
      }
      // A reference established with hidden hands cannot also treat a visible
      // held sign at the same wrist height as rest; that would duplicate it.
      const hiddenReference = options.noHandsAsRest && reference !== null && !reference.hands.some(Boolean)
      const resting = noHands || (!hiddenReference && quiet && reference !== null && atRest(current, reference, settings.restDistance))
      if (phase === 'rearming') {
        if (!resting) restSince = null
        else {
          restSince ??= now
          if (now - restSince >= settings.rearmMs) { phase = 'ready'; restSince = null }
        }
        return []
      }
      if (phase === 'ready' || phase === 'possible-start') {
        if (noHands) { reference = current; movingSince = null; phase = 'ready'; return [] }
        const entering = options.noHandsAsRest && reference !== null && !reference.hands.some(Boolean)
        if ((entering || (speed !== null && speed >= settings.startSpeed)) && current.hands.some(Boolean)) {
          movingSince ??= now
          phase = 'possible-start'
          if (now - movingSince >= settings.startMs) {
            capture = buffer.filter(f => f.timestamp >= movingSince! - settings.preRollMs)
            armedHands = current.hands.map(Boolean)
            phase = 'recording'; restSince = null; lostSince = null
          }
        } else { movingSince = null; phase = 'ready' }
        return []
      }
      if (now - capture[0].timestamp >= settings.maxCaptureMs || capture.length >= 240) return discard('capture-limit', now)
      // Disappearance away from the calibrated rest pose is ambiguous: do not
      // silently treat a lost signing hand as a completed gesture.
      const missing = !noHands && armedHands.some((armed, side) => armed && !current.hands[side]
        && (!!reference?.hands[side] || !resting))
      if (missing) {
        lostSince ??= now; restSince = null
        if (now - lostSince >= settings.lostTrackingMs) return discard('hand-tracking-lost', now)
        return []
      }
      lostSince = null
      if (!resting) { restSince = null; return [] }
      restSince ??= now
      if (now - restSince < settings.endMs) return []
      const frames = capture.filter(f => f.timestamp <= restSince! + settings.postRollMs)
      const e = event('segment', 'returned-to-rest', frames, now)
      if (e.frameCount < 8 || e.endMs - e.startMs < 400 || e.validFraction < 0.8 || e.handPresenceFraction < 0.5) {
        e.type = 'discard'; e.reason = 'capture-quality'
      }
      capture = []; phase = 'rearming'; movingSince = null
      return [e]
    },
    finish(): BoundaryEvent[] {
      if (phase === 'recording') return discard('recording-ended-before-rest', lastTimestamp)
      return []
    },
  }
}
