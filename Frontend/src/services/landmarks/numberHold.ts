import type { SignPrediction } from '../../types/message'
import type { FeatureFrame } from './continuousRecognition'

export const NUMBER_HOLD_SETTINGS = {
  holdMs: 500, minFrames: 8, maxGapMs: 150,
  stableDisplacement: .05, motionDisplacement: .08,
} as const

const numbers = new Set(['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN'])
const movingConfusions = new Set(['WHAT', 'NO', 'WAVE_GREETING', 'WEDNESDAY', 'FRIDAY'])

export type NumberHoldEvidence = {
  label: string; reason: string; blocked: boolean; observedMs: number
  displacement: number | null; stable: boolean; motionObserved: boolean
}

// Shoulder-normalized XY distances include wrist, finger and palm rotation
// evidence. These provisional thresholds require validation on real recordings.
export function holdMotion(frames: FeatureFrame[], holdMs: number, minFrames: number = NUMBER_HOLD_SETTINGS.minFrames) {
  const end = frames[frames.length - 1]?.timestamp ?? 0
  let start = 0
  while (start + 1 < frames.length && frames[start + 1].timestamp <= end - holdMs) start++
  const recent = frames.slice(start)
  const first = recent[0]
  const observedMs = first ? end - first.timestamp : 0
  const sides = first ? [36, 100].filter(offset => first.features[offset] === 1) : []
  const usable = sides.length > 0 && recent.length >= minFrames
    && observedMs >= holdMs
    && recent.every((frame, i) => frame.valid && frame.features[7] >= .5 && frame.features[11] >= .5
      && frame.features.length === 164 && frame.features.every(Number.isFinite)
      && (i === 0 || frame.timestamp > recent[i - 1].timestamp && frame.timestamp - recent[i - 1].timestamp <= NUMBER_HOLD_SETTINGS.maxGapMs)
      && [36, 100].every(offset => frame.features[offset] === first.features[offset]))
  let displacement: number | null = null
  if (usable) {
    displacement = 0
    for (const offset of sides) {
      for (const frame of recent) {
        let distance = 0
        for (let joint = 0; joint < 21; joint++) {
          const index = offset + 1 + joint * 3
          distance += Math.hypot(frame.features[index] - first.features[index], frame.features[index + 1] - first.features[index + 1]) / 21
        }
        displacement = Math.max(displacement, distance)
      }
    }
  }
  return { usable, observedMs, displacement }
}

export function assessNumberHold(frames: FeatureFrame[], prediction: SignPrediction | null): NumberHoldEvidence | null {
  if (!prediction || !numbers.has(prediction.label) && !movingConfusions.has(prediction.label)) return null
  const { usable, observedMs, displacement } = holdMotion(frames, NUMBER_HOLD_SETTINGS.holdMs)
  const stable = displacement !== null && displacement <= NUMBER_HOLD_SETTINGS.stableDisplacement
  const motionObserved = displacement !== null && displacement >= NUMBER_HOLD_SETTINGS.motionDisplacement
  const number = numbers.has(prediction.label)
  const passed = number ? stable : motionObserved
  return { label: prediction.label, reason: !usable ? 'hold_tracking_incomplete'
    : passed ? number ? 'number_hold_ready' : 'confusing_sign_motion_observed'
      : number ? 'number_waiting_for_stable_hold' : 'confusing_sign_waiting_for_motion',
    blocked: !passed, observedMs, displacement, stable, motionObserved }
}
