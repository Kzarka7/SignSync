import type { FeatureFrame } from './continuousRecognition'

// Rolling windows: a fixed 1,333 ms lookback on a 30 Hz grid.
export const LIVE_WINDOW_GRID = {
  windowMs: 1333, frameCount: 40, sampleHz: 30, maxInterpolationGapMs: 200,
} as const

// Segmented gestures: 40 evenly spaced samples over the whole detected sign,
// matching training, where each complete clip is resampled to 40 frames.
// The previous 1,333 ms lookback showed long signs to the model only from
// their tail (2026-11-23 offline check: IX/POSS 92.6% -> 94.6%, 75 signs
// 96.5% -> 97.4% on unseen clips).
export const SIGN_WINDOW_GRID = {
  mode: 'whole-sign', frameCount: 40, maxInterpolationGapMs: 200,
} as const

const HAND_PRESENCE_OFFSETS = [36, 100] as const
const TIMESTAMP_EPSILON_MS = 1e-7

// Interpolates between real observations without filling missing hands,
// invalid pose, or source gaps longer than maxInterpolationGapMs.
function sampleAt(frames: readonly FeatureFrame[], timestamps: readonly number[]): FeatureFrame[] {
  let index = 0
  return timestamps.map(timestamp => {
    while (index + 1 < frames.length && frames[index + 1].timestamp <= timestamp + TIMESTAMP_EPSILON_MS) index++
    const left = frames[index], right = frames[index + 1]
    if (Math.abs(timestamp - left.timestamp) <= TIMESTAMP_EPSILON_MS || !right) return { ...left, timestamp }

    const gap = right.timestamp - left.timestamp
    if (!left.valid || !right.valid || gap > LIVE_WINDOW_GRID.maxInterpolationGapMs) {
      return { timestamp, valid: false, features: new Array<number>(left.features.length).fill(0) }
    }
    const weight = (timestamp - left.timestamp) / gap
    const features = left.features.map((value, channel) => value + (right.features[channel] - value) * weight)
    for (const offset of HAND_PRESENCE_OFFSETS) {
      if (left.features[offset] !== 1 || right.features[offset] !== 1) features.fill(0, offset, offset + 64)
      else features[offset] = 1
    }
    return { timestamp, valid: true, features }
  })
}

// An observation outside the lookback may bracket the first grid step.
// The last of the 40 samples lands on the newest real observation.
export function resampleLiveWindow(frames: readonly FeatureFrame[]): FeatureFrame[] | null {
  const last = frames[frames.length - 1]
  if (!last || last.timestamp - frames[0].timestamp < LIVE_WINDOW_GRID.windowMs) return null
  return sampleAt(frames, Array.from({ length: LIVE_WINDOW_GRID.frameCount },
    (_, step) => last.timestamp - (LIVE_WINDOW_GRID.frameCount - 1 - step) * 1000 / LIVE_WINDOW_GRID.sampleHz))
}

// The first and last samples land on the first and newest real observations.
export function resampleSignWindow(frames: readonly FeatureFrame[]): FeatureFrame[] | null {
  const first = frames[0], last = frames[frames.length - 1]
  if (!first || frames.length < 2 || last.timestamp <= first.timestamp) return null
  const span = last.timestamp - first.timestamp, steps = SIGN_WINDOW_GRID.frameCount - 1
  return sampleAt(frames, Array.from({ length: SIGN_WINDOW_GRID.frameCount },
    (_, step) => step === steps ? last.timestamp : first.timestamp + span * step / steps))
}
