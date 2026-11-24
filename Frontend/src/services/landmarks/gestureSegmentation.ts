import { CONTINUOUS_SETTINGS, type FeatureFrame, type RecognitionWindow } from './continuousRecognition'
import { holdMotion, NUMBER_HOLD_SETTINGS } from './numberHold'
import { hasConfusableFingerChange, type MotionProfile } from './signMotionEvidence'

// Lab-only heuristic boundaries. No learned label or reference-video annotation
// participates in segmentation. A missing hand alone never completes a gesture.
export const GESTURE_SETTINGS = {
  startMs: 100, preRollMs: 100, minDurationMs: 400, maxDurationMs: 4000,
  updateMs: 150, quietMs: 300, missingMs: 200, trimTailMs: 100,
  startSpeed: .5, quietSpeed: .18, minTravel: .18,
  returnY: .6, returnTravel: .3,
} as const
export const PREVIEW_GESTURE_SETTINGS = { holdMs: 400, earlyHoldMs: 350, releaseSideTravel: .12, releaseEvidenceMs: 150, maxDurationMs: 8000 } as const
export const FAST_PREVIEW_BOUNDARIES = {
  settleMs: 250, settleTravel: .015, releaseY: .5, releaseTravel: .23,
  withdrawalEvidenceMs: 550, withdrawalTravel: .22,
} as const
export type GestureWindow = RecognitionWindow & {
  segmentId: number; complete: boolean; decisionMs: number; evidence?: 'hold' | 'motion'; earlyPreview?: true
}
export type GestureEvent = { segmentId: number; type: 'start' | 'complete' | 'discard'; reason: string; timestampMs: number }
const present = (f: FeatureFrame, s: number) => f.features[s ? 100 : 36] === 1
const wrist = (f: FeatureFrame, s: number) => [f.features[s ? 101 : 37], f.features[s ? 102 : 38]]
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const STAGE2_SHAPE_TRAVEL = .07
export const SIGN_TRANSITION_SETTINGS = { stillMs: 120, stillTravel: .035, moveTravel: .10, changeMs: 100, confirmationQuietMs: 950 } as const
// 'motion-e' only. TEN is a thumbs-up tilted back and forth; the tilt moves the joints and the wrist
// enough to pass the generic change tests while TEN is still being signed, so the next window used to
// open mid-TEN and the TEN tail made a following TOMORROW read as TEN. After TEN, the next sign starts
// when the wrist rises (TOMORROW starts near the face), travels far, or the handshape changes beyond
// what TEN's tilt produces; the window starts at the last frame within holdBand of TEN's height, so
// TEN's own last tilt stays out of it. Calibrated on the 43-sign clips (analysis/calibrate_lab_motion_e.py):
// a rise >= .25 occurs in 4% of TEN holds and 93% of TOMORROW clips; TEN's wrist drift reaches .30 and its
// handshape travel .26 (95th percentile); TEN's vertical drift is .14 at the 75th percentile, hence
// holdBand .18. In the 2026-11-24 camera trace every TEN -> TOMORROW rose .6–.9; replaying it
// (analysis/replay_camera_e.cjs) got 5/5 TEN -> TOMORROW switches with holdBand .18, 4/5 with .06 or .12,
// and 3/6 before this rule. TEN is measured against its last referenceMs of frames (median height;
// nearest frame for distance and shape), not the single confirmed frame: in that trace one confirmed
// frame was a tracking glitch .41 above the hold.
export const TEN_DEPARTURE = { rise: .25, travel: .40, shapeTravel: .30, holdBand: .18, referenceMs: 300 } as const
// 'motion-e' only. After a moving word whose number partner is the same handshape held still, stopping
// the motion is the change: with the generic tests the next window either never opened (WHAT -> ONE)
// or opened mid-motion and kept reading the word (WAVE_GREETING -> FIVE). After these words their own
// motion is not a new sign; the next sign starts on a clear departure (TEN_DEPARTURE travel or shape)
// or once the hand has been still for stillMs, from the start of that stillness. Calibrated on the
// 43-sign clips at 30 fps (analysis/calibrate_settle_rule.py, band .035): a 400 ms still run occurs
// inside 5–32% of these words (pauses) and 76–94% of FIVE/ONE/TWO/THREE/SIX holds. A pause can anchor
// the window too early, so recognitionDiagnostics re-anchors to the latest stillness while the window
// still reads as the word.
export const SETTLING_WORDS_E: ReadonlySet<string> = new Set(['WAVE_GREETING', 'WHAT', 'NO', 'WEDNESDAY'])
export const WORD_SETTLE = { stillMs: 400, stillTravel: .035 } as const
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

function handshapeTravel(a: FeatureFrame, b: FeatureFrame, side: number) {
  const start = side ? 101 : 37
  const dx = b.features[start] - a.features[start], dy = b.features[start + 1] - a.features[start + 1]
  let total = 0
  for (let joint = 1; joint < 21; joint++) {
    const i = start + joint * 3
    total += Math.hypot(b.features[i] - a.features[i] - dx, b.features[i + 1] - a.features[i + 1] - dy)
  }
  return total / 21
}

export function findVisibleSignTransition(frames: FeatureFrame[], confirmed: FeatureFrame, confirmedLabel?: string,
  profile: MotionProfile = 'v1'): number | null {
  const { stillMs, stillTravel, moveTravel, changeMs } = SIGN_TRANSITION_SETTINGS
  const sides = [0, 1].filter(s => present(confirmed,s))
  if (!sides.length) return null
  const afterTen = profile === 'motion-e' && confirmedLabel === 'TEN'
  const afterWord = profile === 'motion-e' && !!confirmedLabel && SETTLING_WORDS_E.has(confirmedLabel)
  // The sign's own recent motion: its last referenceMs of frames before confirmation.
  const ownMotion = afterTen || afterWord ? frames.filter(f => f.valid && f.timestamp <= confirmed.timestamp
    && f.timestamp >= confirmed.timestamp-TEN_DEPARTURE.referenceMs && sides.every(s => present(f,s))) : []
  if ((afterTen || afterWord) && !ownMotion.length) ownMotion.push(confirmed)
  const tenHeight = sides.map(s => median(ownMotion.map(f => wrist(f,s)[1])))
  let previous: FeatureFrame | undefined, stillFrom: FeatureFrame | undefined, settled: FeatureFrame | undefined
  let change: { seenMs: number; startMs: number } | undefined, atTenHeightMs: number | undefined
  let latestSettleMs: number | null = null
  for (const frame of frames) {
    const t = frame.timestamp
    if (t < confirmed.timestamp-stillMs-GESTURE_SETTINGS.preRollMs) continue
    if (!frame.valid || !sides.every(s => present(frame,s))
      || previous && t-previous.timestamp > NUMBER_HOLD_SETTINGS.maxGapMs) {
      previous = stillFrom = settled = undefined; change = undefined
      continue
    }
    if (afterTen || afterWord) {
      // Image y grows downward, so a positive rise means the wrist is above where TEN was confirmed.
      const rise = afterTen ? Math.max(...sides.map((s,i) => tenHeight[i]-wrist(frame,s)[1])) : 0
      if (afterTen && rise <= TEN_DEPARTURE.holdBand) atTenHeightMs = t
      const departed = afterTen && rise >= TEN_DEPARTURE.rise || sides.some(s =>
        Math.min(...ownMotion.map(f => distance(wrist(f,s),wrist(frame,s)))) >= TEN_DEPARTURE.travel
        || Math.min(...ownMotion.map(f => handshapeTravel(f,frame,s))) >= TEN_DEPARTURE.shapeTravel)
      if (t > confirmed.timestamp && departed) {
        change ??= { seenMs:t, startMs:Math.max(confirmed.timestamp,
          afterTen ? atTenHeightMs ?? t-GESTURE_SETTINGS.preRollMs : t-GESTURE_SETTINGS.preRollMs) }
        if (t-change.seenMs >= changeMs) return change.startMs
      } else change = undefined
      if (afterWord) {
        // The latest still run of at least WORD_SETTLE.stillMs that ends after confirmation.
        const origin = stillFrom
        if (!origin || sides.some(s => distance(wrist(origin,s),wrist(frame,s)) > WORD_SETTLE.stillTravel
          || handshapeTravel(origin,frame,s) > WORD_SETTLE.stillTravel)) stillFrom = frame
        else if (t > confirmed.timestamp && t-origin.timestamp >= WORD_SETTLE.stillMs)
          latestSettleMs = Math.max(confirmed.timestamp, origin.timestamp)
      }
      previous = frame
      continue
    }
    const resting = settled
    const shapeChanged = sides.some(s => handshapeTravel(confirmed,frame,s) >= STAGE2_SHAPE_TRAVEL
      || confirmedLabel && hasConfusableFingerChange(confirmed,frame,s,confirmedLabel,profile))
    const movedFromHold = resting && sides.some(s => distance(wrist(resting,s),wrist(frame,s)) >= moveTravel)
    if (t > confirmed.timestamp && (shapeChanged || movedFromHold)) {
      change ??= { seenMs:t, startMs:Math.max(confirmed.timestamp,
        movedFromHold ? resting!.timestamp : t-GESTURE_SETTINGS.preRollMs) }
      if (t-change.seenMs >= changeMs) return change.startMs
    } else change = undefined

    const origin = stillFrom
    if (!origin || sides.some(s => distance(wrist(origin,s),wrist(frame,s)) > stillTravel
      || handshapeTravel(origin,frame,s) > stillTravel)) stillFrom = frame
    else if (t-origin.timestamp >= stillMs) settled = frame
    previous = frame
  }
  return latestSettleMs
}

export function createGestureSegmentation(updateMs: number = GESTURE_SETTINGS.updateMs, trackHandshape = false,
  { preview = false, shortPreview = false, fasterBoundaries = false, continuousSigns = false, waitForConfirmation = false,
    settleConfirmedHold = false,
    confirmationQuietMs = SIGN_TRANSITION_SETTINGS.confirmationQuietMs as number } = {}) {
  let previous: FeatureFrame | null = null, history: FeatureFrame[] = [], capture: FeatureFrame[] = []
  let phase: 'observing' | 'recording' = 'observing', id = 0, startSince: number | null = null
  let quietSince: number | null = null, missingSince: number | null = null, lastUpdate = -Infinity
  let origins: number[][] = [], minY = [Infinity, Infinity], lastSeen: (FeatureFrame | null)[] = [null, null]
  let travel = 0, shapeTravel = 0, trustedReturn = false
  let activeSides = [false,false], returned = [false,false]
  let visibleSince: (number|null)[] = [null,null]
  let holdArmed = true, purposefulMotion = false, peakY = [-Infinity, -Infinity]
  let steadyHold: FeatureFrame[] = []
  let earlyPreviewSent = false
  let confirmationPending = false
  let confirmedHold = false
  const reset = () => { phase = 'observing'; capture = []; startSince = quietSince = missingSince = null; travel = 0; trustedReturn = false }
  const usable = (f: FeatureFrame) => f.valid && f.features[7] >= .5 && f.features[11] >= .5
  function stableHoldFrames(t: number, holdMs: number) {
    if (t-capture[0].timestamp < holdMs) return []
    let start = history.length-1
    while (start > 0 && t-history[start].timestamp < holdMs) start--
    const recent = history.slice(start).filter(f => f.timestamp >= capture[0].timestamp)
    const { displacement } = holdMotion(recent,holdMs)
    return displacement !== null && displacement <= NUMBER_HOLD_SETTINGS.stableDisplacement ? recent : []
  }
  return {
    get phase() { return phase },
    get activeSegmentId() { return phase === 'recording' ? id : null },
    collectNextSign(segmentId: number, timestampMs: number) {
      if (phase !== 'recording' || id !== segmentId) return
      capture = capture.filter(f => f.timestamp >= timestampMs)
      confirmationPending = true
      confirmedHold = false
    },
    markConfirmed(segmentId: number) {
      if (phase === 'recording' && id === segmentId) {
        confirmationPending = false
        confirmedHold = settleConfirmedHold
      }
    },
    push(frame: FeatureFrame, occlusionActive = false): { window: GestureWindow | null; events: GestureEvent[] } {
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
      history.push(frame); history = history.filter(f => t - f.timestamp <= (preview ? 550 : 450))
      const hands = [0, 1].filter(s => present(frame, s))
      if (!hands.length) holdArmed = true
      let speed = 0
      if (old) for (const s of hands) if (present(old, s)) {
        // Whole-hand motion includes finger movement as well as wrist motion.
        const offset = s ? 101 : 37
        let mean = 0
        for (let j = 0; j < 21; j++) mean += Math.hypot(frame.features[offset+j*3]-old.features[offset+j*3], frame.features[offset+j*3+1]-old.features[offset+j*3+1]) / 21
        speed = Math.max(speed, mean / ((t-old.timestamp)/1000))
      }
      if (phase === 'observing') {
        if (preview && !hands.length) { startSince = null; return { window:null,events } }
        const entering = hands.length > 0 && old !== null && ![0,1].some(s => present(old,s))
        const anchor = trackHandshape ? history.find(f => t - f.timestamp <= 200 && t - f.timestamp >= GESTURE_SETTINGS.startMs) : undefined
        if (anchor && hands.some(s => present(anchor, s) && handshapeTravel(anchor, frame, s) >= STAGE2_SHAPE_TRAVEL))
          startSince ??= anchor.timestamp
        else if (preview && holdArmed) startSince ??= t
        else if (hands.length && (entering || speed >= GESTURE_SETTINGS.startSpeed || startSince !== null && !old?.features[36] && !old?.features[100])) startSince ??= t
        else if (speed < GESTURE_SETTINGS.startSpeed) startSince = null
        // Keep a short entry onset alive while the hand settles after appearing.
        if (hands.length && startSince !== null && t-startSince >= GESTURE_SETTINGS.startMs) {
          id++; phase = 'recording'
          capture = history.filter(f => f.timestamp >= startSince!-GESTURE_SETTINGS.preRollMs)
          while (capture.length && ![0,1].some(s => present(capture[0],s))) capture.shift()
          origins = [0,1].map(s => wrist(capture[0],s)); minY = [Infinity,Infinity]; lastSeen = [null,null]
          lastUpdate = -Infinity; quietSince = missingSince = null; trustedReturn = false; travel = shapeTravel = 0
          activeSides = [false,false]; returned = [false,false]
          visibleSince = [null,null]
          steadyHold = []; purposefulMotion = false; peakY = [-Infinity,-Infinity]
          earlyPreviewSent = false
          confirmationPending = continuousSigns || waitForConfirmation
          confirmedHold = false
          const reason = preview && holdArmed && speed < GESTURE_SETTINGS.startSpeed ? 'visible_signing_hand' : 'observed_motion'
          holdArmed = false
          events.push({ segmentId:id,type:'start',reason,timestampMs:t })
        } else return { window:null,events }
      } else capture.push(frame)
      if (t-capture[0].timestamp > (preview ? PREVIEW_GESTURE_SETTINGS.maxDurationMs : GESTURE_SETTINGS.maxDurationMs)) return discard('gesture_duration_limit')
      for (const s of hands) {
        const p = wrist(frame,s); minY[s] = Math.min(minY[s],p[1]); travel = Math.max(travel,distance(origins[s],p))
        if (trackHandshape && present(capture[0], s)) shapeTravel = Math.max(shapeTravel, handshapeTravel(capture[0], frame, s))
        if (!lastSeen[s] && !present(capture[0],s)) origins[s] = p
        visibleSince[s] ??= t
        const withdrawalTravel = fasterBoundaries ? FAST_PREVIEW_BOUNDARIES.withdrawalTravel : GESTURE_SETTINGS.returnTravel
        if (fasterBoundaries || p[1] < 0 || p[1]-minY[s] < withdrawalTravel) returned[s] = false
        if (t-visibleSince[s]! >= 100 && distance(origins[s],p) >= .12) activeSides[s] = true
        // Positive evidence of withdrawal, while the hand is still tracked.
        // A high stationary hand disappearing has no such completion evidence.
        const recent = fasterBoundaries
          ? history.slice(history.map(f => present(f,s)).lastIndexOf(false)+1)
            .filter(f => t-f.timestamp <= FAST_PREVIEW_BOUNDARIES.withdrawalEvidenceMs && f.timestamp >= capture[0].timestamp)
          : history.filter(f => t-f.timestamp <= 300 && present(f,s))
        if (recent.length >= 3 && p[1] >= 0 && p[1]-minY[s] >= withdrawalTravel
          && p[1]-wrist(recent[0],s)[1] >= .15
          && (!fasterBoundaries || recent.filter((f,i) => i > 0 && wrist(f,s)[1]-wrist(recent[i-1],s)[1] > .015).length >= 2)) returned[s] = true
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
      if (!occlusionActive && missingSince !== null && t-missingSince >= GESTURE_SETTINGS.missingMs && !trustedReturn) return discard('unverified_hand_loss')
      const wristMoved = travel >= GESTURE_SETTINGS.minTravel
      const shapeMoved = shapeTravel >= STAGE2_SHAPE_TRAVEL
      let holdReleased = false
      let earlyHold: FeatureFrame[] = []
      if (preview) {
        const held = steadyHold[steadyHold.length-1]
        const heldSides = held ? [0,1].filter(s => present(held,s) && (wrist(held,s)[1] < GESTURE_SETTINGS.returnY
          || present(frame,s) && wrist(frame,s)[1]-wrist(held,s)[1] >= .08)) : []
        const loweringHold = held && heldSides.length > 0 && heldSides.every(s => {
          const [x,y] = wrist(frame,s), [hx,hy] = wrist(held,s)
          return present(frame,s) && y > hy && Math.abs(x-hx) <= PREVIEW_GESTURE_SETTINGS.releaseSideTravel
            && handshapeTravel(held,frame,s) < STAGE2_SHAPE_TRAVEL
        })
        if (loweringHold && !purposefulMotion) {
          const recent = history.filter(f => t-f.timestamp <= PREVIEW_GESTURE_SETTINGS.releaseEvidenceMs)
          holdReleased = heldSides.every(s => {
            const y = wrist(frame,s)[1]
            if (y < (fasterBoundaries ? FAST_PREVIEW_BOUNDARIES.releaseY : GESTURE_SETTINGS.returnY)
              || y-wrist(held,s)[1] < (fasterBoundaries ? FAST_PREVIEW_BOUNDARIES.releaseTravel : GESTURE_SETTINGS.returnTravel)
              || recent.some(f => !present(f,s))) return false
            const descendingSteps = recent.filter((f,i) => i > 0 && wrist(f,s)[1]-wrist(recent[i-1],s)[1] > .005)
            return descendingSteps.length >= 2
          })
        }
        // An initial raise can lead to a hold. Once held, use the pose just
        // before movement so a long static prefix cannot dilute the motion.
        if (!loweringHold) for (const s of hands) {
          const reference = held && present(held,s) ? held : capture[0]
          const [x,y] = wrist(frame,s), [ox,oy] = wrist(reference,s)
          if (present(reference,s)) {
            purposefulMotion ||= Math.abs(x-ox) >= GESTURE_SETTINGS.minTravel
              || handshapeTravel(reference,frame,s) >= STAGE2_SHAPE_TRAVEL
              || (held ? Math.abs(y-oy) >= GESTURE_SETTINGS.minTravel
                : peakY[s]-minY[s] >= GESTURE_SETTINGS.minTravel && y-minY[s] >= GESTURE_SETTINGS.minTravel)
          }
          peakY[s] = Math.max(peakY[s],y)
        }
        if (!purposefulMotion && !holdReleased && hands.length) {
          const recent = stableHoldFrames(t,PREVIEW_GESTURE_SETTINGS.holdMs)
          if (recent.length) steadyHold = recent
          else if (shortPreview && !earlyPreviewSent && !steadyHold.length && missingSince === null) {
            earlyHold = stableHoldFrames(t,PREVIEW_GESTURE_SETTINGS.earlyHoldMs)
          }
        }
      }
      const moving = preview ? purposefulMotion : wristMoved || shapeMoved
      if (hands.length && !missingActive && speed <= GESTURE_SETTINGS.quietSpeed && (moving || confirmedHold)) quietSince ??= t
      else quietSince = null
      const withdrawal = !occlusionActive && trustedReturn && missingSince !== null && t-missingSince >= GESTURE_SETTINGS.missingMs
      const quietMs = confirmationPending ? confirmationQuietMs
        : fasterBoundaries ? FAST_PREVIEW_BOUNDARIES.settleMs : GESTURE_SETTINGS.quietMs
      let settled = quietSince !== null && t-quietSince >= quietMs
      if (!settled && fasterBoundaries && moving && missingSince === null) {
        const recent = history.filter(f => f.timestamp >= capture[0].timestamp)
        const { displacement } = holdMotion(recent,FAST_PREVIEW_BOUNDARIES.settleMs,3)
        settled = displacement !== null && displacement <= FAST_PREVIEW_BOUNDARIES.settleTravel
      }
      const complete = holdReleased || settled || withdrawal && (!preview || moving)
      // Stage 2 needs the settled pose to confirm a static sign at completion.
      const end = complete && (!trackHandshape || !settled)
        ? (quietSince ?? Math.max(...lastSeen.map((f,s) => activeSides[s] ? f?.timestamp ?? -Infinity : -Infinity)))-GESTURE_SETTINGS.trimTailMs : t
      const evidence = preview ? moving ? 'motion' : 'hold' : undefined
      const holdEnd = steadyHold[steadyHold.length-1]?.timestamp
      const earlyPreview = earlyHold.length > 0
      let frames = evidence === 'hold' ? earlyPreview ? earlyHold : steadyHold
        : capture.filter(f => f.timestamp <= end && f.timestamp >= (preview && steadyHold.length
          ? holdEnd-GESTURE_SETTINGS.preRollMs : -Infinity))
      if (frames.length > 240) frames = Array.from({length:240},(_,i)=>frames[Math.round(i*(frames.length-1)/239)])
      const enoughFrames = frames.length >= 8 && frames[frames.length-1].timestamp-frames[0].timestamp >= GESTURE_SETTINGS.minDurationMs
      if (fasterBoundaries && settled && !enoughFrames) return {window:null,events}
      if (complete && (!enoughFrames || !moving && !holdReleased && !(settled && confirmedHold))) return discard('gesture_too_short')
      if (!complete && !earlyPreview && (!enoughFrames || t-lastUpdate < updateMs || missingSince !== null
        || evidence === 'hold' && holdEnd !== t)) return {window:null,events}
      if (earlyPreview) earlyPreviewSent = true
      else lastUpdate = t
      const window: GestureWindow = { segmentId:id,complete,decisionMs:t,startMs:frames[0].timestamp,endMs:frames[frames.length-1].timestamp,frames,
        validFraction:frames.filter(usable).length/frames.length,
        handFraction:frames.filter(f=>f.valid && [0,1].some(s=>present(f,s))).length/frames.length,quality:null,
        ...(evidence ? { evidence } : {}), ...(earlyPreview ? { earlyPreview: true } : {}) }
      if (window.validFraction < .8) window.quality = 'pose_tracking_unusable'
      if (complete) {
        events.push({segmentId:id,type:'complete',reason:holdReleased?'held_pose_released':withdrawal?'observed_withdrawal':'motion_settled',timestampMs:t})
        if (holdReleased) holdArmed = false
        reset(); history = []
      }
      return {window,events}
    },
    finish(timestampMs: number): GestureEvent[] {
      const events: GestureEvent[] = phase==='recording'?[{segmentId:id,type:'discard',reason:'source_ended_before_completion',timestampMs}]:[]
      reset();return events
    },
  }
}
