import type { FeatureFrame } from './continuousRecognition'

export const LIVE_WINDOW_GRID = {
  windowMs: 1333, frameCount: 40, sampleHz: 30, maxInterpolationGapMs: 200,
} as const

const HAND_PRESENCE_OFFSETS = [36, 100] as const
const TIMESTAMP_EPSILON_MS = 1e-7

// An observation outside the lookback may bracket the first grid step.
// The last of the 40 samples lands on the newest real observation.
export function resampleLiveWindow(frames: readonly FeatureFrame[]): FeatureFrame[] | null {
  const last = frames[frames.length - 1]
  if (!last || last.timestamp - frames[0].timestamp < LIVE_WINDOW_GRID.windowMs) return null

  let index = 0
  return Array.from({ length: LIVE_WINDOW_GRID.frameCount }, (_, step) => {
    const timestamp = last.timestamp - (LIVE_WINDOW_GRID.frameCount - 1 - step) * 1000 / LIVE_WINDOW_GRID.sampleHz
    while (index + 1 < frames.length && frames[index + 1].timestamp <= timestamp + TIMESTAMP_EPSILON_MS) index++
    const left = frames[index], right = frames[index + 1]
    if (Math.abs(timestamp - left.timestamp) <= TIMESTAMP_EPSILON_MS) return { ...left, timestamp }

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
