import { CONTINUOUS_SETTINGS, type FeatureFrame, type RecognitionWindow } from './continuousRecognition'

// Lab-only heuristic boundaries. No learned label or reference-video annotation
// participates in segmentation. A missing hand alone never completes a gesture.
export const GESTURE_SETTINGS = {
  startMs: 100, preRollMs: 100, minDurationMs: 400, maxDurationMs: 4000,
  updateMs: 150, quietMs: 300, missingMs: 200, trimTailMs: 100,
  startSpeed: .5, quietSpeed: .18, minTravel: .18,
  returnY: .6, returnTravel: .3,
} as const
export type GestureWindow = RecognitionWindow & { segmentId: number; complete: boolean; decisionMs: number }
export type GestureEvent = { segmentId: number; type: 'start' | 'complete' | 'discard'; reason: string; timestampMs: number }
const present = (f: FeatureFrame, s: number) => f.features[s ? 100 : 36] === 1
const wrist = (f: FeatureFrame, s: number) => [f.features[s ? 101 : 37], f.features[s ? 102 : 38]]
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function createGestureSegmentation(updateMs: number = GESTURE_SETTINGS.updateMs) {
  let previous: FeatureFrame | null = null, history: FeatureFrame[] = [], capture: FeatureFrame[] = []
  let phase: 'observing' | 'recording' = 'observing', id = 0, startSince: number | null = null
  let quietSince: number | null = null, missingSince: number | null = null, lastUpdate = -Infinity
  let origins: number[][] = [], minY = [Infinity, Infinity], lastSeen: (FeatureFrame | null)[] = [null, null]
  let travel = 0, trustedReturn = false
  let activeSides = [false,false], returned = [false,false]
  let visibleSince: (number|null)[] = [null,null]
  const reset = () => { phase = 'observing'; capture = []; startSince = quietSince = missingSince = null; travel = 0; trustedReturn = false }
  const usable = (f: FeatureFrame) => f.valid && f.features[7] >= .5 && f.features[11] >= .5
  return {
    get phase() { return phase },
    push(frame: FeatureFrame): { window: GestureWindow | null; events: GestureEvent[] } {
      const t = frame.timestamp, events: GestureEvent[] = []
      if (!Number.isFinite(t) || previous && t <= previous.timestamp) throw Error('Frame timestamps must increase.')
      const old = previous; previous = frame
      const discard = (reason: string) => {
        if (phase === 'recording') events.push({ segmentId: id, type: 'discard', reason, timestampMs: t })
        reset(); history = []; lastSeen = [null, null]
        return { window: null, events }
      }
      if (!usable(frame)) return discard('pose_tracking_lost')
      if (old && t - old.timestamp > CONTINUOUS_SETTINGS.maxGapMs) return discard('camera_frame_gap')
      history.push(frame); history = history.filter(f => t - f.timestamp <= 450)
      const hands = [0, 1].filter(s => present(frame, s))
      let speed = 0
      if (old) for (const s of hands) if (present(old, s)) {
        // Whole-hand motion includes finger movement as well as wrist motion.
        const offset = s ? 101 : 37
        let mean = 0
        for (let j = 0; j < 21; j++) mean += Math.hypot(frame.features[offset+j*3]-old.features[offset+j*3], frame.features[offset+j*3+1]-old.features[offset+j*3+1]) / 21
        speed = Math.max(speed, mean / ((t-old.timestamp)/1000))
      }
      if (phase === 'observing') {
        const entering = hands.length > 0 && old !== null && ![0,1].some(s => present(old,s))
        if (hands.length && (entering || speed >= GESTURE_SETTINGS.startSpeed || startSince !== null && !old?.features[36] && !old?.features[100])) startSince ??= t
        else if (speed < GESTURE_SETTINGS.startSpeed) startSince = null
        // Keep a short entry onset alive while the hand settles after appearing.
        if (hands.length && startSince !== null && t-startSince >= GESTURE_SETTINGS.startMs) {
          id++; phase = 'recording'
          capture = history.filter(f => f.timestamp >= startSince!-GESTURE_SETTINGS.preRollMs)
          while (capture.length && ![0,1].some(s => present(capture[0],s))) capture.shift()
          origins = [0,1].map(s => wrist(capture[0],s)); minY = [Infinity,Infinity]; lastSeen = [null,null]
          lastUpdate = -Infinity; quietSince = missingSince = null; trustedReturn = false; travel = 0
          activeSides = [false,false]; returned = [false,false]
          visibleSince = [null,null]
          events.push({ segmentId:id,type:'start',reason:'observed_motion',timestampMs:t })
        } else return { window:null,events }
      } else capture.push(frame)
      if (t-capture[0].timestamp > GESTURE_SETTINGS.maxDurationMs) return discard('gesture_duration_limit')
      for (const s of hands) {
        const p = wrist(frame,s); minY[s] = Math.min(minY[s],p[1]); travel = Math.max(travel,distance(origins[s],p))
        if (!lastSeen[s] && !present(capture[0],s)) origins[s] = p
        visibleSince[s] ??= t
        if (p[1] < 0 || p[1]-minY[s] < GESTURE_SETTINGS.returnTravel) returned[s] = false
        if (t-visibleSince[s]! >= 100 && distance(origins[s],p) >= .12) activeSides[s] = true
        // Positive evidence of withdrawal, while the hand is still tracked.
        // A high stationary hand disappearing has no such completion evidence.
        const recent = history.filter(f => t-f.timestamp <= 300 && present(f,s))
        if (recent.length >= 3 && p[1] >= 0 && p[1]-minY[s] >= GESTURE_SETTINGS.returnTravel
          && p[1]-wrist(recent[0],s)[1] >= .15) returned[s] = true
        lastSeen[s] = frame
      }
      for (const s of [0,1]) if (!present(frame,s)) visibleSince[s] = null
      const missingActive = [0,1].some(s => activeSides[s] && lastSeen[s] && !present(frame,s))
      trustedReturn = [0,1].some(s=>activeSides[s] && !present(frame,s)) && [0,1].every(s=>{
        if (!activeSides[s] || present(frame,s)) return true
        const offset = s ? 24 : 20
        return returned[s] && frame.features[offset+3] >= .5 && frame.features[offset+1] >= GESTURE_SETTINGS.returnY
          && frame.features[offset+1] >= wrist(lastSeen[s]!,s)[1]+.15
      })
      if (!hands.length || missingActive) missingSince ??= t
      else missingSince = null
      if (missingSince !== null && t-missingSince >= GESTURE_SETTINGS.missingMs && !trustedReturn) return discard('unverified_hand_loss')
      if (hands.length && !missingActive && speed <= GESTURE_SETTINGS.quietSpeed && travel >= GESTURE_SETTINGS.minTravel) quietSince ??= t
      else quietSince = null
      const complete = quietSince !== null && t-quietSince >= GESTURE_SETTINGS.quietMs
        || trustedReturn && missingSince !== null && t-missingSince >= GESTURE_SETTINGS.missingMs
      const end = complete ? (quietSince ?? Math.max(...lastSeen.map((f,s) => activeSides[s] ? f?.timestamp ?? -Infinity : -Infinity)))-GESTURE_SETTINGS.trimTailMs : t
      let frames = capture.filter(f => f.timestamp <= end)
      if (frames.length > 240) frames = Array.from({length:240},(_,i)=>frames[Math.round(i*(frames.length-1)/239)])
      if (complete && (frames.length < 8 || frames[frames.length-1].timestamp-frames[0].timestamp < GESTURE_SETTINGS.minDurationMs || travel < GESTURE_SETTINGS.minTravel)) return discard('gesture_too_short')
      if (!complete && frames.length < 8) return {window:null,events}
      if (!complete && (t-capture[0].timestamp < GESTURE_SETTINGS.minDurationMs || t-lastUpdate < updateMs || missingSince !== null)) return {window:null,events}
      lastUpdate = t
      const window: GestureWindow = { segmentId:id,complete,decisionMs:t,startMs:frames[0].timestamp,endMs:frames[frames.length-1].timestamp,frames,
        validFraction:frames.filter(usable).length/frames.length,
        handFraction:frames.filter(f=>f.valid && [0,1].some(s=>present(f,s))).length/frames.length,quality:null }
      if (window.validFraction < .8) window.quality = 'pose_tracking_unusable'
      if (complete) { events.push({segmentId:id,type:'complete',reason:trustedReturn && missingSince!==null?'observed_withdrawal':'motion_settled',timestampMs:t}); reset(); history = [] }
      return {window,events}
    },
    finish(timestampMs: number): GestureEvent[] {
      const events: GestureEvent[] = phase==='recording'?[{segmentId:id,type:'discard',reason:'source_ended_before_completion',timestampMs}]:[]
      reset();return events
    },
  }
}
