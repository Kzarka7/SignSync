import type { LandmarkFrameSample } from '../../types/landmarks'
import type { SignPrediction, SignRequest } from '../../types/message'
import { FEATURE_ORDER, toFeatureVector } from './normalize'
import { assessNumberHold, holdMotion, NUMBER_HOLD_SETTINGS, type NumberHoldEvidence } from './numberHold'
import { assessSignMotion, SIGN_MOTION_SETTINGS } from './signMotionEvidence'
import { createContinuousSignCapture } from './continuousSignCapture'
import { createGestureSegmentation, findVisibleSignTransition, FAST_PREVIEW_BOUNDARIES, GESTURE_SETTINGS,
  PREVIEW_GESTURE_SETTINGS, SIGN_TRANSITION_SETTINGS, type GestureEvent, type GestureWindow } from './gestureSegmentation'
import {
  CONTINUOUS_SETTINGS, CONTINUOUS_POLICY_VERSION, STAGE2_FAST_CONFIRMATION, createActivityPolicy, createRecognitionWindows, createObservationTracking,
  type FeatureFrame, type RecognitionWindow, type ActivityDecision, type ObservationTracking, type ContinuousSettings, isNonSign, displayActivity,
} from './continuousRecognition'

export type DiagnosticRow = Omit<RecognitionWindow, 'frames'> & ActivityDecision & {
  requestId: string | null; prediction: SignPrediction | null; roundTripMs: number | null
  resultAgeMs: number; frameCount: number
  tracking: ObservationTracking
  numberHold?: NumberHoldEvidence | null
  signMotion?: ReturnType<typeof assessSignMotion>
  completionValidation?: SignPrediction | null; segmentId?: number; complete?: boolean; decisionMs?: number
  evidence?: GestureWindow['evidence']; earlyPreview?: true
}
export type LabTranscriptEntry = { label: string; score: number; decisionMs: number; requestId: string }
export const EXAMPLE_ANNOTATIONS = [
  { startMs: 6000, endMs: 8000, label: 'THANK_YOU', source: 'user approximate interval' },
  { startMs: 11000, endMs: 13000, label: 'YES', source: 'user approximate interval' },
]
// These moving signs can score highly on stationary input with the pilot checkpoint.
const PREVIEW_MOTION_REQUIRED = new Set(['WHAT', 'TEN'])
const PREVIEW_ACCEPTANCE = { recentMs: 650, strongScore: .90, strongMargin: .30, singleScore: .94,
  minHandFraction: .8, recoveryScore: .50, recoveryMargin: .15, recoveryVoteSpanMs: 150 } as const
type PreviewVote = { label: string; timestampMs: number; evidence: GestureWindow['evidence']; strong: boolean }
export const FINGERSPELLING_PAUSE_MS = 1200
const predictionMargin = (prediction: SignPrediction) => prediction.score - (prediction.top3.find(p => p.label !== prediction.label)?.score ?? 1)
const strongPreview = (prediction: SignPrediction) => prediction.score >= PREVIEW_ACCEPTANCE.strongScore
  && predictionMargin(prediction) >= PREVIEW_ACCEPTANCE.strongMargin

// No production transcript or model changes. The replay waits for each request;
// the camera retains at most one pending window, replacing it with fresh data.
export function createDiagnosticSession(options: {
  source: 'video' | 'camera'; name: string
  predict: (request: SignRequest) => Promise<SignPrediction>
  onChange: () => void; now?: () => number; id?: () => string
  onWordBoundary?: () => void
  settings?: Partial<ContinuousSettings>
  recognitionMode?: 'rolling' | 'segmented'
  modelMode?: string
  numberHoldExperiment?: boolean
  segmentAcceptance?: 'confirmation' | 'completion' | 'preview'
  shortPreview?: boolean
  adaptivePreview?: boolean
  minimumConfidence?: number
  waitForConfirmation?: boolean
  settleConfirmedHold?: boolean
  staticMotionCheck?: boolean
}) {
  const now = options.now ?? (() => performance.now())
  const id = options.id ?? (() => crypto.randomUUID())
  const settings = { ...CONTINUOUS_SETTINGS, ...options.settings }
  const { minimumConfidence } = options
  if (minimumConfidence !== undefined && !(minimumConfidence >= 0 && minimumConfidence <= 1))
    throw Error('Minimum confidence must be between zero and one.')
  const recognitionMode = options.recognitionMode ?? 'rolling'
  const segmentAcceptance = options.segmentAcceptance ?? 'completion'
  const stage2 = options.modelMode === 'lab-stage2'
  const preview = recognitionMode === 'segmented' && segmentAcceptance === 'preview'
  const shortPreview = preview && options.shortPreview === true
  const adaptivePreview = preview && options.adaptivePreview === true
  const timedPreview = preview && minimumConfidence !== undefined
  const continuousSignTransitions = recognitionMode === 'segmented' && segmentAcceptance === 'confirmation'
    && (options.modelMode === 'lab-signs43-numbers' || options.modelMode === 'lab-signs43-shape-motion'
      || options.modelMode === 'lab-signs43-similarity' || options.modelMode === 'lab-alphabet')
  const waitForConfirmation = recognitionMode === 'segmented' && segmentAcceptance === 'confirmation'
    && options.waitForConfirmation === true
  const confirmationQuietMs = minimumConfidence === undefined && !waitForConfirmation ? SIGN_TRANSITION_SETTINGS.confirmationQuietMs
    : Math.max(SIGN_TRANSITION_SETTINGS.confirmationQuietMs, GESTURE_SETTINGS.minDurationMs + settings.confirmationMs + 2*settings.strideMs)
  const segmenter = createGestureSegmentation(settings.strideMs, stage2 || preview || continuousSignTransitions,
    { preview, shortPreview, fasterBoundaries: adaptivePreview, continuousSigns: continuousSignTransitions,
      waitForConfirmation, confirmationQuietMs, settleConfirmedHold: options.settleConfirmedHold }), segmentationEvents: GestureEvent[] = []
  const discarded = new Set<number>(), segmentPolicies = new Map<number, ReturnType<typeof createActivityPolicy>>()
  const proposals = new Map<number, { label: string; timestampMs: number }>()
  const previews = new Map<number, PreviewVote[]>()
  let lastSegmentLabel: string | null = null, repeatArmed = true, bodyRevision = 0
  let lastAcceptedSegment: number | null = null
  let confirmedFrame: FeatureFrame | null = null, transitionStart: number | null = null
  let completedBoundary: GestureEvent | null = null
  const repeatBoundaries = new Map<number, GestureEvent>()
  let nonSignSince: number | null = null, previousNonSignMs = -Infinity
  const segmentAcceptanceEvents: {timestampMs:number;type:string;reason:string;label:string|null;source:string|null;evidenceMs:number}[] = []
  type WorkWindow = RecognitionWindow & Partial<Pick<GestureWindow, 'segmentId' | 'complete' | 'decisionMs' | 'evidence' | 'earlyPreview'>>
  const windows = createRecognitionWindows(settings), policy = createActivityPolicy(settings, stage2)
  const tracker = createObservationTracking(settings)
  const boundaries = createContinuousSignCapture()
  const frames: FeatureFrame[] = [], rows: DiagnosticRow[] = [], transcript: LabTranscriptEntry[] = []
  const boundaryEvents: unknown[] = []
  const trackingEvents: ObservationTracking[] = []
  let tracking: ObservationTracking | null = null
  let origin: number | null = null, latestMs = 0, stopped = false, generation = 0
  type Work = { window: WorkWindow; observedAt: number; tracking: ObservationTracking }
  let pending: Work | null = null
  const completedQueue: Work[] = []
  const wordBoundaries: number[] = []
  let inFlight: Promise<void> | null = null, replacedWindows = 0, staleResults = 0, frameGaps = 0
  let lastFrameMs: number | null = null, lastNotificationMs = -Infinity
  let status = 'Observing', failure: string | null = null
  const startedAt = new Date().toISOString()

  async function classify(window: WorkWindow, observedAt: number, windowTracking: ObservationTracking) {
    const followingSign = continuousSignTransitions && confirmedFrame && window.segmentId === lastAcceptedSegment
    if (followingSign && confirmedFrame && !window.quality) {
      if (transitionStart === null) {
        transitionStart = findVisibleSignTransition(window.frames,confirmedFrame,options.staticMotionCheck ? lastSegmentLabel ?? undefined : undefined)
        if (transitionStart !== null) segmenter.collectNextSign(lastAcceptedSegment!,transitionStart)
      }
      if (transitionStart === null) window = {...window,quality:'waiting_for_new_sign'}
      else {
        const fresh = window.frames.filter(frame => frame.timestamp >= transitionStart!)
        if (fresh.length < 8 || fresh[fresh.length-1].timestamp-fresh[0].timestamp < GESTURE_SETTINGS.minDurationMs)
          window = {...window,quality:'collecting_new_sign'}
        else window = {...window,frames:fresh,startMs:fresh[0].timestamp,
          validFraction:fresh.filter(f=>f.valid).length/fresh.length,
          handFraction:fresh.filter(f=>f.valid && (f.features[36] === 1 || f.features[100] === 1)).length/fresh.length}
      }
    }
    const token = generation, started = now(), requestId = window.quality || windowTracking.state === 'pose-lost' ? null : id()
    const expectedBodyRevision = bodyRevision
    let prediction: SignPrediction | null = null, completionValidation: SignPrediction | null = null, blocked = window.quality
    try {
      if (requestId) prediction = await options.predict({ requestId, featureOrder: FEATURE_ORDER, frames: window.frames,
        ...(window.earlyPreview ? { preview: true } : {}) })
      if (stopped || token !== generation) return
      if (requestId && window.complete && segmentAcceptance === 'completion') {
        const core = window.frames.filter(f=>f.timestamp >= window.startMs+150 && f.timestamp <= window.endMs-150)
        if (core.length >= 8 && core[core.length-1].timestamp-core[0].timestamp >= 400) {
          completionValidation = await options.predict({requestId:id(),featureOrder:FEATURE_ORDER,frames:core})
        }
      }
    } catch (error) {
      if (stopped || token !== generation) return
      blocked = 'inference_error'; failure = String(error)
    }
    if (stopped || token !== generation) return
    const decisionMs = window.decisionMs ?? window.endMs
    const resultAgeMs = options.source === 'camera' ? Math.max(latestMs - decisionMs, now() - observedAt) : 0
    if (resultAgeMs > settings.maxResultAgeMs) { blocked = 'stale_result'; staleResults++ }
    if (!blocked && (bodyRevision !== expectedBodyRevision || !window.complete && tracking?.revision !== windowTracking.revision)) blocked = 'tracking_changed_during_inference'
    if (window.segmentId !== undefined && discarded.has(window.segmentId)) blocked = 'gesture_discarded'
    const numberHold = options.numberHoldExperiment ? assessNumberHold(window.frames, prediction) : null
    const signMotion = options.staticMotionCheck && prediction ? assessSignMotion(window.frames,prediction.label) : null
    const motionBlocked = signMotion?.reason ?? undefined
    if (!blocked && numberHold?.blocked) blocked = numberHold.reason
    if (!blocked && !signMotion && preview && window.evidence === 'hold' && prediction && PREVIEW_MOTION_REQUIRED.has(prediction.label))
      blocked = 'sign_requires_motion'
    if (!blocked && !signMotion && continuousSignTransitions && prediction && PREVIEW_MOTION_REQUIRED.has(prediction.label)) {
      const { displacement } = holdMotion(window.frames,window.endMs-window.startMs)
      if (displacement !== null && displacement <= NUMBER_HOLD_SETTINGS.stableDisplacement) blocked = 'sign_requires_motion'
    }
    const belowMinimumConfidence = minimumConfidence !== undefined && prediction !== null
      && !isNonSign(prediction.label) && prediction.score < minimumConfidence
    if (!blocked && !preview && belowMinimumConfidence && !prediction?.rejectionReason) blocked = 'below_minimum_confidence'
    let decision: ActivityDecision
    if (window.segmentId !== undefined) {
      const sid = window.segmentId
      let currentPolicy = segmentPolicies.get(sid)
      if (!currentPolicy) { currentPolicy = createActivityPolicy(settings, stage2); segmentPolicies.set(sid,currentPolicy) }
      decision = currentPolicy.update(prediction,decisionMs,blocked ?? undefined,undefined,motionBlocked)
      if (blocked) proposals.delete(sid)
      if (decision.emit && prediction) proposals.set(sid,{label:prediction.label,timestampMs:decisionMs})
      const prior = proposals.get(sid)
      if (!blocked && prediction?.accepted && prior?.label === prediction.label && decisionMs-prior.timestampMs <= settings.maxEvidenceGapMs) prior.timestampMs = decisionMs
      if (!blocked && prediction && isNonSign(prediction.label) && prediction.score >= settings.nonSignMinScore
        && prediction.score-(prediction.top3.find(p=>p.label!==prediction.label)?.score ?? 1) >= settings.nonSignMinMargin) {
        if (decisionMs-previousNonSignMs > settings.maxEvidenceGapMs) nonSignSince = null
        nonSignSince ??= decisionMs; previousNonSignMs = decisionMs
        if (decisionMs-nonSignSince >= settings.rearmMs && !repeatArmed) {
          repeatArmed = true
          segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'rearmed',reason:'sustained_non_sign_evidence',label:lastSegmentLabel,source:'model',evidenceMs:decisionMs-nonSignSince})
        }
      } else nonSignSince = null
      if (preview) {
        const usable = !blocked && prediction && !prediction.rejectionReason && !isNonSign(prediction.label) ? prediction : null
        const label = usable?.accepted ? usable.label : null
        const eligible = label && !belowMinimumConfidence
        const recentMs = timedPreview ? settings.confirmationMs + settings.maxEvidenceGapMs
          : adaptivePreview ? PREVIEW_ACCEPTANCE.recentMs : settings.maxEvidenceGapMs
        const evidenceMs = timedPreview ? window.endMs : decisionMs
        let recent = (previews.get(sid) ?? []).filter(vote => vote.evidence === window.evidence && evidenceMs-vote.timestampMs <= recentMs)
        if (timedPreview && recent.length && evidenceMs-recent[recent.length-1].timestampMs > settings.maxEvidenceGapMs) recent = []
        const last = recent[recent.length-1]
        let confirmation: string | null = null
        if (window.complete && usable && !motionBlocked) {
          if (timedPreview) {
            const matching = recent.filter(vote => vote.label === label)
            const votes = matching.length + (last && evidenceMs > last.timestampMs ? 1 : 0)
            if (eligible && last?.label === label && matching.length && votes >= settings.confirmationWindows
              && evidenceMs-matching[0].timestampMs >= settings.confirmationMs) confirmation = 'gesture_completed_confirmed'
          } else if (label && last?.label === label) confirmation = 'gesture_completed_confirmed'
          else if (adaptivePreview) {
            const strong = recent.filter(vote => vote.strong)
            const agreeing = strong.filter(vote => vote.label === usable.label)
            const enoughHands = window.handFraction >= PREVIEW_ACCEPTANCE.minHandFraction
            const supported = enoughHands && agreeing.length >= 2 && strong[strong.length-1]?.label === usable.label
              && agreeing[agreeing.length-1].timestampMs-agreeing[0].timestampMs >= PREVIEW_ACCEPTANCE.recoveryVoteSpanMs
            if (label && supported) confirmation = 'gesture_completed_recent_agreement'
            else if (!label && supported && usable.score >= PREVIEW_ACCEPTANCE.recoveryScore
              && predictionMargin(usable) >= PREVIEW_ACCEPTANCE.recoveryMargin) confirmation = 'gesture_completed_supported_low_score'
            else if (label && enoughHands && window.evidence === 'motion' && !last
              && usable.score >= PREVIEW_ACCEPTANCE.singleScore && strongPreview(usable)) confirmation = 'gesture_completed_strong_motion'
          }
        }
        const emit = confirmation !== null
        if (!window.earlyPreview) {
          if (eligible && label && !window.complete && usable) {
            const vote = { label,timestampMs:evidenceMs,evidence:window.evidence,strong:strongPreview(usable) }
            const limit = timedPreview ? Math.max(1,settings.confirmationHistory-1) : adaptivePreview ? 3 : 1
            previews.set(sid,[...recent,vote].slice(-limit))
          } else if (timedPreview || !adaptivePreview || window.complete || !usable) previews.delete(sid)
        }
        decision = { ...decision,emit,activity:label && !window.complete && !motionBlocked ? `PREVIEW · ${displayActivity(label)}`
          : emit ? `CONFIRMED · ${displayActivity(usable!.label)}` : 'UNCERTAIN',
          reason:blocked ?? confirmation ?? (timedPreview && belowMinimumConfidence && !prediction?.rejectionReason
            ? 'below_minimum_confidence' : motionBlocked ?? (window.complete && timedPreview && eligible ? 'completion_needs_more_evidence'
            : window.complete ? !adaptivePreview ? 'gesture_completion_unconfirmed'
            : prediction?.rejectionReason ?? (!label ? 'completion_low_confidence' : last ? 'completion_label_disagrees' : 'completion_needs_support')
            : label ? 'gesture_preview' : decision.reason)) }
        if (emit && usable) {
          lastSegmentLabel = usable.label; repeatArmed = false
          segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'accepted',reason:decision.reason,label:usable.label,
            source:window.evidence ?? null,evidenceMs:last ? decisionMs-last.timestampMs : 0})
        }
        if (window.complete) { segmentPolicies.delete(sid); proposals.delete(sid) }
      } else if (segmentAcceptance === 'confirmation') {
        const boundary = repeatBoundaries.get(sid)
        const newGesture = boundary !== undefined && boundary.segmentId === lastAcceptedSegment
          && window.startMs >= boundary.timestampMs
        // A confirmed label can repeat after a physical segment boundary. Within
        // the same capture, fresh landmarks must support a different sign.
        const duplicate = followingSign && prediction?.label === lastSegmentLabel
        const emit = decision.emit && (!window.complete || stage2 || continuousSignTransitions) && !duplicate
        const waitingForChange = blocked === 'waiting_for_new_sign' || blocked === 'collecting_new_sign'
        decision = { ...decision, emit,
          activity: waitingForChange && lastSegmentLabel
            ? displayActivity(lastSegmentLabel) : decision.activity,
          reason: blocked ?? (emit ? 'gesture_accepted_on_confirmation'
            : duplicate ? 'duplicate_sign_suppressed'
            : motionBlocked ?? (window.complete ? 'gesture_completion_diagnostic_only' : decision.reason)) }
        if (emit && prediction) {
          if (newGesture && lastSegmentLabel === prediction.label && !repeatArmed) {
            segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'rearmed',reason:'completed_gesture_then_new_motion',label:lastSegmentLabel,source:'gesture',evidenceMs:decisionMs-boundary!.timestampMs})
          }
          else if (lastSegmentLabel === prediction.label && !repeatArmed) {
            segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'rearmed',reason:'fresh_segment_confirmation',label:lastSegmentLabel,source:'confirmation',evidenceMs:decisionMs-window.startMs})
          }
          lastAcceptedSegment = sid
          lastSegmentLabel = prediction.label; repeatArmed = false
          if (continuousSignTransitions || waitForConfirmation) segmenter.markConfirmed(sid)
          if (continuousSignTransitions) {
            confirmedFrame = window.frames[window.frames.length-1]
            transitionStart = null
          }
          segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'accepted',reason:'gesture_accepted_on_confirmation',label:lastSegmentLabel,source:null,evidenceMs:0})
        }
        if (window.complete) { segmentPolicies.delete(sid); proposals.delete(sid) }
      } else if (window.complete) {
        const confirmed = proposals.get(sid)
        const matches = !blocked && !motionBlocked && prediction?.accepted && !prediction.rejectionReason && !isNonSign(prediction.label)
          && confirmed?.label === prediction.label && decisionMs-confirmed.timestampMs <= settings.maxEvidenceGapMs
          && (!completionValidation || completionValidation.accepted && completionValidation.label === prediction.label && !completionValidation.rejectionReason)
        const duplicate = matches && lastSegmentLabel === prediction!.label && !repeatArmed
        const emit = !!matches && !duplicate
        decision = { ...decision,emit,activity:emit ? displayActivity(prediction!.label) : 'UNCERTAIN',
          reason:blocked ?? (duplicate ? 'duplicate_sign_suppressed' : emit ? 'gesture_completed_confirmed' : 'gesture_completion_unconfirmed') }
        if (emit) {
          lastSegmentLabel = prediction!.label; repeatArmed = false
          segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'accepted',reason:'gesture_completed_confirmed',label:lastSegmentLabel,source:null,evidenceMs:0})
        }
        segmentPolicies.delete(sid); proposals.delete(sid)
      } else {
        decision = { ...decision,emit:false,reason:decision.emit ? 'gesture_confirmed_waiting_completion' : decision.reason }
      }
      if (discarded.has(sid)) { segmentPolicies.delete(sid); proposals.delete(sid) }
    } else decision = policy.update(prediction, window.endMs, blocked ?? undefined, window.startMs,motionBlocked)
    const { frames: windowFrames, ...details } = window
    const row = { ...details, ...decision, requestId, prediction,
      roundTripMs: requestId ? now() - started : null, resultAgeMs, frameCount: windowFrames.length,
      tracking: { ...tracking! }, completionValidation, numberHold, signMotion }
    rows.push(row)
    if (decision.emit && prediction && requestId) transcript.push({ label: prediction.label, score: prediction.score,
      decisionMs: decisionMs + resultAgeMs, requestId })
    status = failure ? 'Inference error — stop and reconnect' : decision.activity
    options.onChange()
    if (failure) { stopped = true; pending = null; completedQueue.length = 0 }
  }

  function emitWordBoundaries(beforeMs = Infinity) {
    while (wordBoundaries.length && wordBoundaries[0] < beforeMs) {
      wordBoundaries.shift()
      options.onWordBoundary?.()
    }
  }

  function pump() {
    if (stopped || inFlight) return
    const completed = completedQueue[0]
    const boundary = wordBoundaries[0]
    const windowTime = (work: Work) => work.window.decisionMs ?? work.window.endMs
    // Finish any pre-pause windows before adding letters from a new word.
    const work = boundary !== undefined && completed && pending && windowTime(completed) > boundary && windowTime(pending) <= boundary
      ? pending : completed ?? pending
    emitWordBoundaries(work ? windowTime(work) : Infinity)
    if (!work) return
    if (work === pending) pending = null
    else completedQueue.shift()
    inFlight = classify(work.window, work.observedAt, work.tracking).finally(() => { inFlight = null; pump() })
  }
  return {
    get active() { return !stopped },
    get state() { return { status, failure, frames: frames.length, latestMs, rows, transcript, replacedWindows, staleResults,
      busy: inFlight !== null, pending: pending !== null || completedQueue.length > 0, pendingCompletions:completedQueue.length, frameGaps,
      boundaryPhase: boundaries.phase, tracking, acceptance: policy.state, recognitionMode, segmentationPhase:segmenter.phase,
      activeSegmentId: segmenter.activeSegmentId,
      lastSegmentationEvent:segmentationEvents[segmentationEvents.length-1] ?? null } },
    async observe(sample: LandmarkFrameSample) {
      if (stopped) return
      origin ??= sample.timestamp
      const relative = { ...sample, timestamp: sample.timestamp - origin }
      for (const { event } of boundaries.push(relative)) boundaryEvents.push(event)
      await this.observeFeatures({ timestamp: relative.timestamp, ...toFeatureVector(relative) })
    },
    // Exported normalized frames can use the exact camera policy without a
    // second landmark extraction. Raw motion-boundary comparison is unavailable.
    async observeFeatures(featureFrame: FeatureFrame) {
      if (stopped) return
      latestMs = featureFrame.timestamp
      if (lastFrameMs !== null && latestMs - lastFrameMs > settings.maxGapMs) frameGaps++
      lastFrameMs = latestMs
      // A bounded development session avoids retaining unlimited landmark data.
      if (latestMs > 300000 || frames.length >= 12000) { this.stop('Five-minute / frame limit reached'); return }
      frames.push(featureFrame)
      const nextTracking = tracker.push(featureFrame)
      if (options.onWordBoundary && nextTracking.state === 'no-hands'
        && nextTracking.noHandsMs >= FINGERSPELLING_PAUSE_MS
        && (tracking?.noHandsMs ?? 0) < FINGERSPELLING_PAUSE_MS) {
        wordBoundaries.push(latestMs)
      }
      const trackingChanged = !tracking || tracking.state !== nextTracking.state || nextTracking.gapMs > 0
      const wasWaiting = policy.state.waitingForBoundary
      if (trackingChanged) trackingEvents.push(nextTracking)
      tracking = nextTracking
      if (trackingChanged && (tracking.state === 'pose-lost' || tracking.state === 'frame-gap' || tracking.state === 'hands-missing')) completedBoundary = null
      if (tracking.state === 'pose-lost' || tracking.state === 'frame-gap') bodyRevision++
      if (continuousSignTransitions && trackingChanged && tracking.state !== 'visible') {
        transitionStart = null
        if (lastAcceptedSegment !== null) segmentPolicies.delete(lastAcceptedSegment)
      }
      if (tracking.state === 'no-hands' && tracking.noHandsMs >= settings.noHandsIdleMs+settings.rearmMs && !repeatArmed) {
        repeatArmed = true
        segmentAcceptanceEvents.push({timestampMs:latestMs,type:'rearmed',reason:'sustained_non_sign_evidence',label:lastSegmentLabel,source:'no-hands',evidenceMs:tracking.noHandsMs-settings.noHandsIdleMs})
      }
      let window: WorkWindow | null
      const result = segmenter.push(featureFrame)
      segmentationEvents.push(...result.events)
      if (recognitionMode === 'segmented') {
        for (const event of result.events) {
          if (event.type === 'complete') completedBoundary = event
          if (event.type === 'start') {
            if (completedBoundary) repeatBoundaries.set(event.segmentId,completedBoundary)
            completedBoundary = null
          }
          if (event.type === 'discard') {
            discarded.add(event.segmentId); proposals.delete(event.segmentId); segmentPolicies.delete(event.segmentId); previews.delete(event.segmentId)
            repeatBoundaries.delete(event.segmentId); completedBoundary = null
          }
        }
        window = result.window
      } else {
        policy.observeTracking(tracking)
        for (const event of result.events) {
          if (event.type === 'complete') completedBoundary = event
          if (event.type === 'start') {
            if (completedBoundary) policy.observeGestureBoundary(completedBoundary.timestampMs, event.timestampMs)
            completedBoundary = null
          }
          if (event.type === 'discard') { completedBoundary = null; policy.discardGestureBoundary() }
        }
        window = windows.push(featureFrame)
      }
      if (trackingChanged || adaptivePreview && result.events.length || wasWaiting !== policy.state.waitingForBoundary || latestMs - lastNotificationMs >= 500) {
        lastNotificationMs = latestMs; options.onChange()
      }
      if (!window) {
        if (wordBoundaries.length) {
          if (options.source === 'video') emitWordBoundaries()
          else pump()
        }
        return
      }
      if (options.source === 'video') {
        emitWordBoundaries(window.decisionMs ?? window.endMs)
        await classify(window, now(), tracking)
      } else {
        const work = { window, observedAt: now(), tracking }
        if (window.complete) {
          if (completedQueue.length >= 2) {
            const dropped = completedQueue.shift()!; discarded.add(dropped.window.segmentId!)
            previews.delete(dropped.window.segmentId!)
            segmentationEvents.push({segmentId:dropped.window.segmentId!,type:'discard',reason:'completion_queue_full',timestampMs:latestMs})
          }
          completedQueue.push(work)
          if (pending?.window.segmentId === window.segmentId) { pending = null; replacedWindows++ }
        } else { if (pending) replacedWindows++; pending = work }
        pump()
      }
    },
    stop(reason = 'Stopped') { segmentationEvents.push(...segmenter.finish(latestMs)); stopped = true; generation++; pending = null; completedQueue.length = 0; status = reason; options.onChange() },
    async finish() {
      if (inFlight) await inFlight
      if (!stopped) this.stop('Complete')
    },
    report() {
      return { format: 'signsync-continuous-diagnostics', version: 1, purpose: 'development-only',
        modelMode: options.modelMode ?? 'p4-candidate',
        numberHoldExperiment: options.numberHoldExperiment ? { version: 1, ...NUMBER_HOLD_SETTINGS } : null,
        source: options.source, name: options.name, startedAt, settings, minimumConfidence:minimumConfidence ?? null,
        signMotionSettings:options.staticMotionCheck ? SIGN_MOTION_SETTINGS : null,
        stage2Confirmation: stage2 ? { ...STAGE2_FAST_CONFIRMATION, allowsCompletionVote: recognitionMode === 'segmented' } : null,
        policyVersion: CONTINUOUS_POLICY_VERSION,
        recognitionMode, segmentAcceptance, singleConfirmationPerSegment:preview,
        signTransitionSettings:continuousSignTransitions ? { ...SIGN_TRANSITION_SETTINGS, confirmationQuietMs } : null,
        segmentationVersion:recognitionMode === 'segmented' ? continuousSignTransitions ? 8 : adaptivePreview ? 7 : shortPreview ? 6 : preview ? 5 : 4 : null,
        previewGestureSettings:preview ? {...PREVIEW_GESTURE_SETTINGS, earlyHoldMs:shortPreview ? PREVIEW_GESTURE_SETTINGS.earlyHoldMs : null} : null,
        adaptivePreviewSettings:adaptivePreview ? { ...PREVIEW_ACCEPTANCE, ...FAST_PREVIEW_BOUNDARIES } : null,
        previewMotionRequired:preview ? [...PREVIEW_MOTION_REQUIRED] : null,
        gestureSettings:recognitionMode === 'segmented' ? {...GESTURE_SETTINGS,updateMs:settings.strideMs,
          ...(waitForConfirmation ? {confirmationQuietMs} : {})} : null, segmentationEvents,
        featureOrder: FEATURE_ORDER, annotations: [],
        summary: { frameCount: frames.length, durationMs: latestMs, windowCount: rows.length,
          replacedWindows, staleResults, frameGaps, boundaryPhase: boundaries.phase,
          transcriptEntries: transcript.length, status, failure,
          rearmedByGesture: (recognitionMode === 'segmented' ? segmentAcceptanceEvents : policy.events).filter(e => e.type === 'rearmed' && e.reason === 'completed_gesture_then_new_motion').length,
          rearmedByNoHands: (recognitionMode === 'segmented' ? segmentAcceptanceEvents : policy.events).filter(e => e.type === 'rearmed' && e.source === 'no-hands').length,
          rearmedByModel: (recognitionMode === 'segmented' ? segmentAcceptanceEvents : policy.events).filter(e => e.type === 'rearmed' && e.source === 'model').length },
        limitations: [
          'Complete-clip classifier evaluated on overlapping windows; temporal rules are provisional.',
          'Replay processes every window offline; wall-clock throughput is not live camera performance.',
          'Scores are not calibrated accuracy. Repeated windows can share a confident error.',
          'Boundary comparison uses the existing motion/rest detector; it does not establish ground truth.',
          'This development recording must not be treated as independent validation or a sign training sample.',
          'No-hands IDLE is an application visibility rule, not a learned IDLE prediction or physical-rest ground truth.',
        ], rows, transcript, boundaryEvents, trackingEvents, acceptanceEvents: recognitionMode === 'segmented' ? segmentAcceptanceEvents : policy.events, frames }
    },
  }
}
