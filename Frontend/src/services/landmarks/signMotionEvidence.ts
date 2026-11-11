import type { FeatureFrame } from './continuousRecognition'
import { holdMotion } from './numberHold'

// Calibrated on the 43-sign validation clips in shoulder and palm units.
export const SIGN_MOTION_SETTINGS = { lateralTurn: .12, fingerTurn: .45, steadyMs: 300,
  steadyTravel: .07, maxGapMs: 250, minFrames: 5, minSpanMs: 160, fingerOnset: .35, indexOnset: .09 } as const

function reversal(values: number[]) {
  let low = values[0], high = values[0], rise = 0, fall = 0, turn = 0
  for (const value of values) {
    turn = Math.max(turn,Math.min(rise,high-value),Math.min(fall,value-low))
    rise = Math.max(rise,value-low); fall = Math.max(fall,high-value)
    low = Math.min(low,value); high = Math.max(high,value)
  }
  return turn
}

function fingerGap(features: number[], offset: number) {
  const distance = (a: number,b: number) => {
    const i = offset+1+3*a, j = offset+1+3*b
    return Math.hypot(features[i]-features[j],features[i+1]-features[j+1],features[i+2]-features[j+2])
  }
  const palm = distance(0,9)
  return palm >= .03 ? (distance(4,8)+distance(4,12))/(2*palm) : NaN
}

export function hasConfusableFingerChange(a: FeatureFrame,b: FeatureFrame,side: number,label: string) {
  const offset = side ? 100 : 36
  if (label === 'ONE' || label === 'WHAT') {
    const relative = (f: FeatureFrame) => f.features[offset+25]-f.features[offset+1]
    return Math.abs(relative(a)-relative(b)) >= SIGN_MOTION_SETTINGS.indexOnset
  }
  return (label === 'NO' || label === 'TWO' || label === 'THREE')
    && Math.abs(fingerGap(a.features,offset)-fingerGap(b.features,offset)) >= SIGN_MOTION_SETTINGS.fingerOnset
}

export function assessSignMotion(frames: FeatureFrame[], label: string) {
  const lateral = label === 'ONE' || label === 'WHAT'
  if (!lateral && label !== 'NO' && label !== 'TWO' && label !== 'THREE') return null
  const cue = lateral ? 'lateral_index_turn' : 'thumb_finger_turn'
  const threshold = lateral ? SIGN_MOTION_SETTINGS.lateralTurn : SIGN_MOTION_SETTINGS.fingerTurn
  let turn: number | null = null
  for (const offset of [36,100]) {
    let run: { value: number; timestamp: number }[] = [], last = -Infinity
    const measure = () => {
      if (run.length < SIGN_MOTION_SETTINGS.minFrames || last-run[0].timestamp < SIGN_MOTION_SETTINGS.minSpanMs) return
      // Suppress isolated landmark spikes on densely sampled clips. On sparse
      // clips, use the actual observations rather than smoothing away a tap.
      const samples = run.map(({value,timestamp},i) => {
        const before = run[i-1], after = run[i+1]
        return before && after && timestamp-before.timestamp <= 85 && after.timestamp-timestamp <= 85
          ? [before.value,value,after.value].sort((a,b)=>a-b)[1] : value
      })
      turn = Math.max(turn ?? 0,reversal(samples))
    }
    for (const frame of frames) {
      const { features,timestamp } = frame
      if (!frame.valid || features[7] < .5 || features[11] < .5 || timestamp-last > SIGN_MOTION_SETTINGS.maxGapMs) {
        measure(); run = []
      }
      if (!frame.valid || features[7] < .5 || features[11] < .5 || features[offset] !== 1) continue
      const value = lateral ? features[offset+25] : fingerGap(features,offset)
      if (!Number.isFinite(value)) continue
      run.push({value,timestamp}); last = timestamp
    }
    measure()
  }
  const moving = label === 'WHAT' || label === 'NO'
  const displacement = moving ? null : holdMotion(frames,SIGN_MOTION_SETTINGS.steadyMs,5).displacement
  const reason = turn === null ? 'motion_tracking_incomplete'
    : moving ? turn < threshold ? lateral ? 'awaiting_sideways_reversal' : 'awaiting_finger_reversal' : null
      : turn >= threshold ? 'motion_conflicts_with_number'
      : displacement === null || displacement > SIGN_MOTION_SETTINGS.steadyTravel ? 'awaiting_steady_number' : null
  return { cue,turn,threshold,displacement,reason }
}
