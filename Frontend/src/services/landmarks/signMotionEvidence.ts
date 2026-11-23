import type { SignPrediction } from '../../types/message'
import type { FeatureFrame } from './continuousRecognition'
import { holdMotion } from './numberHold'

// Calibrated on the 43-sign validation clips in shoulder and palm units.
// pathTurn and settleMs were chosen on the recorded ONE–NINE, WHAT, NO and
// WEDNESDAY sample clips: WEDNESDAY judged as SIX passes in 17/80 clips (was
// 80/80), WHAT/NO judged as numbers pass no more often than before, and each
// number still passes in all but 1–4 of its ~120 clips. A live WEDNESDAY circle
// measured .23–.28, so .25 rather than the clips' wider .3.
export const SIGN_MOTION_SETTINGS = { lateralTurn: .12, fingerTurn: .45, pathTurn: .25, steadyMs: 300, settleMs: 800,
  steadyTravel: .07, maxGapMs: 250, minFrames: 5, minSpanMs: 160, fingerOnset: .35, indexOnset: .09,
  // The paired word must have this much model score of its own before motion
  // can hand it the pair. A single twitch of a held ONE leaves WHAT at .01–.03.
  pairMinScore: .1,
  // The backend rejects on margin, and a number and its word split their
  // score, so a pair resolved by motion counts as accepted at this pair score.
  pairAcceptScore: .8 } as const

// A number is its handshape held still. Its paired word is the same (or a
// near) handshape plus motion, so motion, not the handshape, decides the pair.
export const STATIC_NUMBERS: ReadonlySet<string> = new Set(['ZERO','ONE','TWO','THREE','FOUR','FIVE','SIX','SEVEN','EIGHT','NINE'])
export const NUMBER_WORD_PAIRS: Readonly<Record<string, readonly string[]>> = {
  ONE:['WHAT'], TWO:['NO'], THREE:['NO'], SIX:['WEDNESDAY'],
  WHAT:['ONE'], NO:['TWO','THREE'], WEDNESDAY:['SIX'],
}
const MOVING_WORDS: Readonly<Record<string, Cue>> = { WHAT:'lateral_index_turn', NO:'thumb_finger_turn', WEDNESDAY:'hand_path_turn' }
const NUMBER_CUES: Readonly<Record<string, Cue>> = { ONE:'lateral_index_turn', TWO:'thumb_finger_turn', THREE:'thumb_finger_turn' }
type Cue = 'lateral_index_turn' | 'thumb_finger_turn' | 'hand_path_turn'
const THRESHOLDS: Record<Cue, number> = { lateral_index_turn:SIGN_MOTION_SETTINGS.lateralTurn,
  thumb_finger_turn:SIGN_MOTION_SETTINGS.fingerTurn, hand_path_turn:SIGN_MOTION_SETTINGS.pathTurn }
const AWAITING: Record<Cue, string> = { lateral_index_turn:'awaiting_sideways_reversal',
  thumb_finger_turn:'awaiting_finger_reversal', hand_path_turn:'awaiting_hand_motion' }

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

// Largest back-and-forth of one landmark value over the tracked runs, or null
// when no run is long enough to measure.
function measureTurn(frames: FeatureFrame[], cue: Cue) {
  const values: ((features: number[], offset: number) => number)[] = cue === 'lateral_index_turn' ? [(f,o) => f[o+25]]
    : cue === 'thumb_finger_turn' ? [fingerGap]
    // Circling or shaking the whole hand reverses the wrist in x or y; the
    // approach into a held number is one-way, so it barely registers.
    : [(f,o) => f[o+1], (f,o) => f[o+2]]
  let turn: number | null = null
  for (const offset of [36,100]) for (const valueOf of values) {
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
      const value = valueOf(features,offset)
      if (!Number.isFinite(value)) continue
      run.push({value,timestamp}); last = timestamp
    }
    measure()
  }
  return turn as number | null
}

const recent = (frames: FeatureFrame[], ms: number) => {
  const end = frames[frames.length-1]?.timestamp ?? 0
  return frames.filter(frame => frame.timestamp >= end-ms)
}

export type SignMotionEvidence = {
  cue: Cue; turn: number | null; threshold: number
  pathTurn: number | null; recentTurn: number | null; recentPathTurn: number | null
  displacement: number | null; reason: string | null
  resolvedFrom?: string; pairScore?: number
}

/**
 * Motion evidence for a predicted label, or null when the label has none.
 * A moving word needs its cue somewhere in the window. A static number needs
 * a steady hold at the end; after earlier motion in the window (a twitch, or
 * the paired word's motion) that hold must be longer and free of motion, so an
 * old twitch delays the number instead of blocking it for the whole segment.
 */
export function assessSignMotion(frames: FeatureFrame[], label: string): SignMotionEvidence | null {
  const word = MOVING_WORDS[label]
  if (word) {
    const turn = measureTurn(frames,word), threshold = THRESHOLDS[word]
    return { cue:word,turn,threshold,pathTurn:word === 'hand_path_turn' ? turn : null,recentTurn:null,recentPathTurn:null,
      displacement:null,reason:turn === null ? 'motion_tracking_incomplete' : turn < threshold ? AWAITING[word] : null }
  }
  if (!STATIC_NUMBERS.has(label)) return null
  const cue = NUMBER_CUES[label] ?? 'hand_path_turn', threshold = THRESHOLDS[cue]
  const turn = cue === 'hand_path_turn' ? null : measureTurn(frames,cue)
  const pathTurn = measureTurn(frames,'hand_path_turn')
  // The finger cue has always required tracking; the path cue is new, so a
  // gap there falls back to the steady-hold check alone.
  if (cue !== 'hand_path_turn' && turn === null) return { cue,turn,threshold,pathTurn,recentTurn:null,recentPathTurn:null,
    displacement:null,reason:'motion_tracking_incomplete' }
  const moved = (turn ?? 0) >= threshold || (pathTurn ?? 0) >= SIGN_MOTION_SETTINGS.pathTurn
  if (!moved) {
    const { displacement } = holdMotion(frames,SIGN_MOTION_SETTINGS.steadyMs,5)
    return { cue,turn:turn ?? pathTurn,threshold:cue === 'hand_path_turn' ? SIGN_MOTION_SETTINGS.pathTurn : threshold,
      pathTurn,recentTurn:null,recentPathTurn:null,displacement,
      reason:displacement === null || displacement > SIGN_MOTION_SETTINGS.steadyTravel ? 'awaiting_steady_number' : null }
  }
  const tail = recent(frames,SIGN_MOTION_SETTINGS.settleMs)
  const recentTurn = cue === 'hand_path_turn' ? null : measureTurn(tail,cue)
  const recentPathTurn = measureTurn(tail,'hand_path_turn')
  const { displacement } = holdMotion(frames,SIGN_MOTION_SETTINGS.settleMs,5)
  const stillMoving = (recentTurn ?? 0) >= threshold || (recentPathTurn ?? 0) >= SIGN_MOTION_SETTINGS.pathTurn
  return { cue,turn:turn ?? pathTurn,threshold:cue === 'hand_path_turn' ? SIGN_MOTION_SETTINGS.pathTurn : threshold,
    pathTurn,recentTurn,recentPathTurn,displacement,
    reason:stillMoving ? 'motion_conflicts_with_number'
      : displacement === null || displacement > SIGN_MOTION_SETTINGS.steadyTravel ? 'awaiting_settled_number' : null }
}

/**
 * Pick between a number and its paired word by motion. The model's scores for
 * a pair mostly measure the shared handshape, so once the word's motion is
 * present, the word takes the pair's combined score. A number blocked because
 * the hand is still moving becomes its paired word when that word's motion
 * check passes. It never goes the other way: a word still waiting for its
 * motion just waits, since a brief pause before circling or shaking is not a number.
 */
export function resolveSignByMotion(frames: FeatureFrame[], prediction: SignPrediction) {
  const own = assessSignMotion(frames,prediction.label)
  const pairs = NUMBER_WORD_PAIRS[prediction.label]
  if (!own || !pairs) return { prediction,signMotion:own }
  const pairScore = (label: string) => prediction.top3.filter(item => item.label === label
    || (NUMBER_WORD_PAIRS[label] ?? []).includes(item.label)).reduce((sum,item) => sum+item.score,0)
  const accepted = (score: number) => prediction.accepted || score >= SIGN_MOTION_SETTINGS.pairAcceptScore
  if (own.reason === null && MOVING_WORDS[prediction.label]) {
    const score = Math.max(prediction.score,pairScore(prediction.label))
    return { prediction:{...prediction,score,accepted:accepted(score)},signMotion:{...own,pairScore:score} }
  }
  if (own.reason !== 'motion_conflicts_with_number') return { prediction,signMotion:own }
  for (const candidate of prediction.top3.filter(item => pairs.includes(item.label) && item.score >= SIGN_MOTION_SETTINGS.pairMinScore)) {
    const other = assessSignMotion(frames,candidate.label)
    if (other?.reason !== null) continue
    const score = Math.max(candidate.score,pairScore(candidate.label))
    return { prediction:{...prediction,label:candidate.label,score,accepted:accepted(score)},
      signMotion:{...other,resolvedFrom:prediction.label,pairScore:score} }
  }
  return { prediction,signMotion:own }
}
