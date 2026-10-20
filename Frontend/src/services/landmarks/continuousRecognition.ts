import type { SignPrediction, SignRequest } from '../../types/message'

export const CONTINUOUS_SETTINGS = {
  windowMs: 1500, strideMs: 350, maxGapMs: 300, minFrames: 8,
  minValidFraction: .8, confirmationMs: 350, confirmationWindows: 2, confirmationHistory: 3,
  rearmMs: 750, maxEvidenceGapMs: 1000, maxResultAgeMs: 1500,
  nonSignMinScore: .63, nonSignMinMargin: .15,
  noHandsIdleMs: 500, frameFreshnessMs: 750, minShoulderVisibility: .5,
} as const
export const CONTINUOUS_POLICY_VERSION = 3
export type ContinuousSettings = { [K in keyof typeof CONTINUOUS_SETTINGS]: number }
export type FeatureFrame = SignRequest['frames'][number]
export type RecognitionWindow = {
  startMs: number; endMs: number; frames: FeatureFrame[]
  validFraction: number; handFraction: number; quality: string | null
}
export const isNonSign = (label: string) => ['REST', 'IDLE', 'IDLE_MOVEMENT'].includes(label)
export const displayActivity = (label: string) => label === 'IDLE_MOVEMENT' ? 'IDLE' : label.replace(/_/g, ' ')

export type ObservationTracking = {
  state: 'visible' | 'hands-missing' | 'no-hands' | 'pose-lost' | 'frame-gap'
  timestampMs: number; noHandsMs: number; revision: number; gapMs: number
}
export function createObservationTracking(overrides: Partial<ContinuousSettings> = {}) {
  const settings = { ...CONTINUOUS_SETTINGS, ...overrides }
  let previousMs: number | null = null, missingSince: number | null = null, revision = 0
  let state: ObservationTracking['state'] = 'visible'
  return {
    push(frame: FeatureFrame): ObservationTracking {
      if (!Number.isFinite(frame.timestamp) || (previousMs !== null && frame.timestamp <= previousMs)) throw Error('Frame timestamps must increase.')
      const gapMs = previousMs === null ? 0 : frame.timestamp - previousMs
      previousMs = frame.timestamp
      const gap = gapMs > settings.maxGapMs
      if (gap) missingSince = null
      const poseValid = frame.valid && frame.features[7] >= settings.minShoulderVisibility && frame.features[11] >= settings.minShoulderVisibility
      const hands = frame.features[36] === 1 || frame.features[100] === 1
      let next: ObservationTracking['state']
      if (!poseValid) { missingSince = null; next = 'pose-lost' }
      else if (gap) { next = 'frame-gap' }
      else if (hands) { missingSince = null; next = 'visible' }
      else {
        missingSince ??= frame.timestamp
        next = frame.timestamp - missingSince >= settings.noHandsIdleMs ? 'no-hands' : 'hands-missing'
      }
      if (next !== state || gap) revision++
      state = next
      return { state, timestampMs: frame.timestamp, noHandsMs: missingSince === null ? 0 : frame.timestamp - missingSince, revision, gapMs: gap ? gapMs : 0 }
    },
  }
}

// This buffer advances during every activity. No rest-pose calibration or
// disappearance of the hands is required to obtain the next prediction.
export function createRecognitionWindows(settings: ContinuousSettings = CONTINUOUS_SETTINGS) {
  let frames: FeatureFrame[] = [], last = -Infinity, emitted = -Infinity
  return {
    push(frame: FeatureFrame): RecognitionWindow | null {
      if (!Number.isFinite(frame.timestamp) || frame.timestamp <= last) throw Error('Frame timestamps must increase.')
      if (frame.timestamp - last > settings.maxGapMs) frames = []
      last = frame.timestamp
      frames.push(frame)
      // Keep one observation just before the window edge for consistent coverage
      // at different camera frame rates.
      while (frames.length > 1 && frames[1].timestamp <= last - settings.windowMs) frames.shift()
      if (last - frames[0].timestamp < settings.windowMs || last - emitted < settings.strideMs) return null
      emitted = last
      const selected = frames.length > 240
        ? Array.from({ length: 240 }, (_, i) => frames[Math.round(i * (frames.length - 1) / 239)]) : [...frames]
      const validFraction = selected.filter(f => f.valid).length / selected.length
      const handFraction = selected.filter(f => f.valid && (f.features[36] === 1 || f.features[100] === 1)).length / selected.length
      return { startMs: selected[0].timestamp, endMs: last, frames: selected, validFraction, handFraction,
        quality: selected.length < settings.minFrames ? 'too_few_frames'
          : validFraction < settings.minValidFraction || !frame.valid ? 'pose_tracking_unusable' : null }
    },
  }
}

export type AcceptanceState = {
  waitingForBoundary: boolean; lastAcceptedLabel: string | null
  boundaryEvidenceMs: number; requiredBoundaryMs: number; boundarySource: 'model' | 'no-hands' | null
}
export type ActivityDecision = { activity: string; reason: string; emit: boolean; acceptance: AcceptanceState }
export type AcceptanceEvent = { timestampMs: number; type: string; reason: string; source: 'model' | 'no-hands' | null; evidenceMs: number; label: string | null }
// Provisional temporal policy, shared by camera and replay. Adjacent windows
// overlap, so consistency is not independent evidence or calibrated confidence.
export function createActivityPolicy(overrides: Partial<ContinuousSettings> = {}) {
  const settings = { ...CONTINUOUS_SETTINGS, ...overrides }
  let previousMs = -Infinity
  let votes: { label: string | null; endMs: number }[] = []
  let latched = false, lastAcceptedLabel: string | null = null
  let evidenceSince: number | null = null, evidenceSource: AcceptanceState['boundarySource'] = null, timeMs = 0
  let evidenceThrough = 0
  let tracking: ObservationTracking | null = null
  const events: AcceptanceEvent[] = []
  const event = (type: string, reason: string) => events.push({ timestampMs: timeMs, type, reason,
    source: evidenceSource, evidenceMs: evidenceSince === null ? 0 : evidenceThrough - evidenceSince, label: lastAcceptedLabel })
  const clearCandidate = () => { votes = [] }
  const vote = (label: string | null, endMs: number) => {
    votes.push({ label, endMs })
    votes = votes.slice(-settings.confirmationHistory)
  }
  const interruptEvidence = (reason: string) => {
    if (evidenceSince !== null && latched) event('rearming_interrupted', reason)
    evidenceSince = null; evidenceSource = null
  }
  const breakEvidence = (reason: string) => { clearCandidate(); interruptEvidence(reason) }
  const acceptance = (): AcceptanceState => ({ waitingForBoundary: latched, lastAcceptedLabel,
    boundaryEvidenceMs: evidenceSince === null ? 0 : Math.max(0, evidenceThrough - evidenceSince),
    requiredBoundaryMs: settings.rearmMs, boundarySource: evidenceSource })
  const decision = (activity: string, reason: string, emit = false): ActivityDecision => ({ activity, reason, emit, acceptance: acceptance() })
  const addEvidence = (source: 'model' | 'no-hands') => {
    if (evidenceSource !== source) interruptEvidence('boundary_source_changed')
    evidenceThrough = timeMs
    if (evidenceSince === null) {
      evidenceSince = timeMs; evidenceSource = source
      if (latched) event('rearming_started', 'non_sign_evidence')
    }
    if (latched && timeMs - evidenceSince >= settings.rearmMs) {
      event('rearmed', 'sustained_non_sign_evidence'); latched = false
    }
  }
  return {
    get state() { return acceptance() },
    get events() { return events },
    observeTracking(observation: ObservationTracking) {
      const was = tracking?.state
      tracking = observation; timeMs = observation.timestampMs
      if (observation.state === 'no-hands') {
        clearCandidate(); addEvidence('no-hands')
      } else if (observation.state !== 'visible') breakEvidence(observation.state)
      else if (was && was !== 'visible') breakEvidence('tracking_recovered')
    },
    update(prediction: SignPrediction | null, endMs: number, blocked?: string): ActivityDecision {
      // Keep the observation clock monotonic when a camera result arrives late.
      timeMs = Math.max(timeMs, endMs)
      if (tracking?.state === 'no-hands') return decision('IDLE', 'no_hands_idle_rule')
      if (tracking?.state === 'hands-missing') return decision('TRACKING INTERRUPTED', 'hands_temporarily_missing')
      if (tracking?.state === 'pose-lost') return decision('TRACKING LOST', 'pose_tracking_lost')
      if (tracking?.state === 'frame-gap') return decision('TRACKING INTERRUPTED', 'camera_frame_gap')
      if (endMs - previousMs > settings.maxEvidenceGapMs) breakEvidence('prediction_evidence_gap')
      previousMs = endMs
      if (!prediction || blocked || prediction.rejectionReason) {
        const reason = blocked ?? prediction?.rejectionReason ?? 'no_prediction'
        breakEvidence(reason)
        return decision('UNCERTAIN', reason)
      }
      if (isNonSign(prediction.label)) {
        vote(null, endMs)
        const runnerUp = prediction.top3.find(item => item.label !== prediction.label)?.score ?? 1
        if (prediction.score < settings.nonSignMinScore || prediction.score - runnerUp < settings.nonSignMinMargin) {
          interruptEvidence('uncertain_non_sign')
          return decision('UNCERTAIN', 'uncertain_non_sign')
        }
        addEvidence('model')
        return decision(displayActivity(prediction.label), latched ? 'non_sign_rearming' : 'non_sign')
      }
      interruptEvidence('sign_prediction')
      if (!prediction.accepted) {
        vote(null, endMs)
        return decision('UNCERTAIN', 'model_rejected')
      }
      vote(prediction.label, endMs)
      if (latched && lastAcceptedLabel === prediction.label) return decision(displayActivity(prediction.label), 'duplicate_sign_suppressed')
      const supporting = votes.filter(item => item.label === prediction.label)
      if (supporting.length < settings.confirmationWindows || endMs - supporting[0].endMs < settings.confirmationMs) {
        return decision(`POSSIBLE ${displayActivity(prediction.label)}`, 'confirming')
      }
      // Consume evidence: each new entry needs fresh supporting predictions.
      clearCandidate()
      latched = true; lastAcceptedLabel = prediction.label; event('accepted', 'confirmed_sign')
      return decision(displayActivity(prediction.label), 'accepted_once', true)
    },
  }
}
