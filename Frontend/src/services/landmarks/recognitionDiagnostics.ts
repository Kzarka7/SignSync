import type { LandmarkFrameSample } from '../../types/landmarks'
import type { SignPrediction, SignRequest } from '../../types/message'
import { FEATURE_ORDER, toFeatureVector } from './normalize'
import { createContinuousSignCapture } from './continuousSignCapture'
import { createGestureSegmentation, GESTURE_SETTINGS, type GestureEvent, type GestureWindow } from './gestureSegmentation'
import {
  CONTINUOUS_SETTINGS, CONTINUOUS_POLICY_VERSION, createActivityPolicy, createRecognitionWindows, createObservationTracking,
  type FeatureFrame, type RecognitionWindow, type ActivityDecision, type ObservationTracking, type ContinuousSettings, isNonSign, displayActivity,
} from './continuousRecognition'

export type DiagnosticRow = Omit<RecognitionWindow, 'frames'> & ActivityDecision & {
  requestId: string | null; prediction: SignPrediction | null; roundTripMs: number | null
  resultAgeMs: number; frameCount: number
  tracking: ObservationTracking
  completionValidation?: SignPrediction | null; segmentId?: number; complete?: boolean; decisionMs?: number
}
export type LabTranscriptEntry = { label: string; score: number; decisionMs: number; requestId: string }
export const EXAMPLE_ANNOTATIONS = [
  { startMs: 6000, endMs: 8000, label: 'THANK_YOU', source: 'user approximate interval' },
  { startMs: 11000, endMs: 13000, label: 'YES', source: 'user approximate interval' },
]

// No production transcript or model changes. The replay waits for each request;
// the camera retains at most one pending window, replacing it with fresh data.
export function createDiagnosticSession(options: {
  source: 'video' | 'camera'; name: string
  predict: (request: SignRequest) => Promise<SignPrediction>
  onChange: () => void; now?: () => number; id?: () => string
  settings?: Partial<ContinuousSettings>
  recognitionMode?: 'rolling' | 'segmented'
  segmentAcceptance?: 'confirmation' | 'completion'
}) {
  const now = options.now ?? (() => performance.now())
  const id = options.id ?? (() => crypto.randomUUID())
  const settings = { ...CONTINUOUS_SETTINGS, ...options.settings }
  const recognitionMode = options.recognitionMode ?? 'rolling'
  const segmentAcceptance = options.segmentAcceptance ?? 'completion'
  const segmenter = createGestureSegmentation(settings.strideMs), segmentationEvents: GestureEvent[] = []
  const discarded = new Set<number>(), segmentPolicies = new Map<number, ReturnType<typeof createActivityPolicy>>()
  const proposals = new Map<number, { label: string; timestampMs: number }>()
  let lastSegmentLabel: string | null = null, repeatArmed = true, bodyRevision = 0
  let lastAcceptedSegment: number | null = null
  let completedBoundary: GestureEvent | null = null
  const repeatBoundaries = new Map<number, GestureEvent>()
  let nonSignSince: number | null = null, previousNonSignMs = -Infinity
  const segmentAcceptanceEvents: {timestampMs:number;type:string;reason:string;label:string|null;source:string|null;evidenceMs:number}[] = []
  type WorkWindow = RecognitionWindow & Partial<Pick<GestureWindow, 'segmentId' | 'complete' | 'decisionMs'>>
  const windows = createRecognitionWindows(settings), policy = createActivityPolicy(settings)
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
  let inFlight: Promise<void> | null = null, replacedWindows = 0, staleResults = 0, frameGaps = 0
  let lastFrameMs: number | null = null, lastNotificationMs = -Infinity
  let status = 'Observing', failure: string | null = null
  const startedAt = new Date().toISOString()

  async function classify(window: WorkWindow, observedAt: number, windowTracking: ObservationTracking) {
    const token = generation, started = now(), requestId = window.quality || windowTracking.state === 'pose-lost' ? null : id()
    const expectedBodyRevision = bodyRevision
    let prediction: SignPrediction | null = null, completionValidation: SignPrediction | null = null, blocked = window.quality
    try {
      if (requestId) prediction = await options.predict({ requestId, featureOrder: FEATURE_ORDER, frames: window.frames })
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
    let decision: ActivityDecision
    if (window.segmentId !== undefined) {
      const sid = window.segmentId
      let currentPolicy = segmentPolicies.get(sid)
      if (!currentPolicy) { currentPolicy = createActivityPolicy(settings); segmentPolicies.set(sid,currentPolicy) }
      decision = currentPolicy.update(prediction,decisionMs,blocked ?? undefined)
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
      if (segmentAcceptance === 'confirmation') {
        const boundary = repeatBoundaries.get(sid)
        const newGesture = boundary !== undefined && boundary.segmentId === lastAcceptedSegment
          && window.startMs >= boundary.timestampMs
        // The segment policy already suppresses a held prediction. Do not veto
        // a fresh confirmation merely because the previous segment had this label.
        const emit = decision.emit && !window.complete
        decision = { ...decision, emit,
          reason: blocked ?? (emit ? 'gesture_accepted_on_confirmation' : window.complete ? 'gesture_completion_diagnostic_only' : decision.reason) }
        if (emit && prediction) {
          if (newGesture && lastSegmentLabel === prediction.label && !repeatArmed) {
            segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'rearmed',reason:'completed_gesture_then_new_motion',label:lastSegmentLabel,source:'gesture',evidenceMs:decisionMs-boundary!.timestampMs})
          }
          else if (lastSegmentLabel === prediction.label && !repeatArmed) {
            segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'rearmed',reason:'fresh_segment_confirmation',label:lastSegmentLabel,source:'confirmation',evidenceMs:decisionMs-window.startMs})
          }
          lastAcceptedSegment = sid
          lastSegmentLabel = prediction.label; repeatArmed = false
          segmentAcceptanceEvents.push({timestampMs:decisionMs,type:'accepted',reason:'gesture_accepted_on_confirmation',label:lastSegmentLabel,source:null,evidenceMs:0})
        }
        if (window.complete) { segmentPolicies.delete(sid); proposals.delete(sid) }
      } else if (window.complete) {
        const confirmed = proposals.get(sid)
        const matches = !blocked && prediction?.accepted && !prediction.rejectionReason && !isNonSign(prediction.label)
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
    } else decision = policy.update(prediction, window.endMs, blocked ?? undefined)
    const { frames: windowFrames, ...details } = window
    const row = { ...details, ...decision, requestId, prediction,
      roundTripMs: requestId ? now() - started : null, resultAgeMs, frameCount: windowFrames.length,
      tracking: { ...tracking! }, completionValidation }
    rows.push(row)
    if (decision.emit && prediction && requestId) transcript.push({ label: prediction.label, score: prediction.score,
      decisionMs: decisionMs + resultAgeMs, requestId })
    status = failure ? 'Inference error — stop and reconnect' : decision.activity
    options.onChange()
    if (failure) { stopped = true; pending = null; completedQueue.length = 0 }
  }

  function pump() {
    if (stopped || inFlight || !pending && !completedQueue.length) return
    const work = completedQueue.shift() ?? pending!
    if (work === pending) pending = null
    inFlight = classify(work.window, work.observedAt, work.tracking).finally(() => { inFlight = null; pump() })
  }
  return {
    get active() { return !stopped },
    get state() { return { status, failure, frames: frames.length, latestMs, rows, transcript, replacedWindows, staleResults,
      busy: inFlight !== null, pending: pending !== null || completedQueue.length > 0, pendingCompletions:completedQueue.length, frameGaps,
      boundaryPhase: boundaries.phase, tracking, acceptance: policy.state, recognitionMode, segmentationPhase:segmenter.phase,
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
      const trackingChanged = !tracking || tracking.state !== nextTracking.state || nextTracking.gapMs > 0
      const wasWaiting = policy.state.waitingForBoundary
      if (trackingChanged) trackingEvents.push(nextTracking)
      tracking = nextTracking
      if (trackingChanged && (tracking.state === 'pose-lost' || tracking.state === 'frame-gap' || tracking.state === 'hands-missing')) completedBoundary = null
      if (tracking.state === 'pose-lost' || tracking.state === 'frame-gap') bodyRevision++
      if (tracking.state === 'no-hands' && tracking.noHandsMs >= settings.noHandsIdleMs+settings.rearmMs && !repeatArmed) {
        repeatArmed = true
        segmentAcceptanceEvents.push({timestampMs:latestMs,type:'rearmed',reason:'sustained_non_sign_evidence',label:lastSegmentLabel,source:'no-hands',evidenceMs:tracking.noHandsMs-settings.noHandsIdleMs})
      }
      let window: WorkWindow | null
      if (recognitionMode === 'segmented') {
        const result = segmenter.push(featureFrame)
        segmentationEvents.push(...result.events)
        for (const event of result.events) {
          if (event.type === 'complete') completedBoundary = event
          if (event.type === 'start') {
            if (completedBoundary) repeatBoundaries.set(event.segmentId,completedBoundary)
            completedBoundary = null
          }
          if (event.type === 'discard') {
            discarded.add(event.segmentId); proposals.delete(event.segmentId); segmentPolicies.delete(event.segmentId)
            repeatBoundaries.delete(event.segmentId); completedBoundary = null
          }
        }
        window = result.window
      } else { policy.observeTracking(tracking); window = windows.push(featureFrame) }
      if (trackingChanged || wasWaiting !== policy.state.waitingForBoundary || latestMs - lastNotificationMs >= 500) {
        lastNotificationMs = latestMs; options.onChange()
      }
      if (!window) return
      if (options.source === 'video') await classify(window, now(), tracking)
      else {
        const work = { window, observedAt: now(), tracking }
        if (window.complete) {
          if (completedQueue.length >= 2) {
            const dropped = completedQueue.shift()!; discarded.add(dropped.window.segmentId!)
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
        modelMode: 'p4-candidate',
        source: options.source, name: options.name, startedAt, settings,
        policyVersion: CONTINUOUS_POLICY_VERSION,
        recognitionMode, segmentAcceptance, segmentationVersion:recognitionMode === 'segmented' ? 4 : null,
        gestureSettings:recognitionMode === 'segmented' ? {...GESTURE_SETTINGS,updateMs:settings.strideMs} : null, segmentationEvents,
        featureOrder: FEATURE_ORDER, annotations: [],
        summary: { frameCount: frames.length, durationMs: latestMs, windowCount: rows.length,
          replacedWindows, staleResults, frameGaps, boundaryPhase: boundaries.phase,
          transcriptEntries: transcript.length, status, failure,
          rearmedByGesture: segmentAcceptanceEvents.filter(e => e.type === 'rearmed' && e.source === 'gesture').length,
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
