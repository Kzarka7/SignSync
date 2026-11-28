import { getRecognitionSettings } from '../recognitionSettings'

// Promoted 2026-11-25: 43 Similar Signs motion E (sign-motion-cues-v1 + BiGRU) replaces the v1 baseline.
export const LIVE_SIGNS_MODEL = 'lab-signs43-motion-e'
export const LIVE_MOTION_PROFILE = 'motion-e' as const

// Shared by Live Conversation and Recognition Lab. Repeated labels are allowed
// after fresh confirmation in a new segment, without a cross-segment label latch.
export const LIVE_RECOGNITION_POLICY = {
  recognitionMode: 'segmented',
  segmentAcceptance: 'confirmation',
} as const

export function getRecognitionConfirmation() {
  const { minimumConfidence, acceptanceMs } = getRecognitionSettings()
  const strideMs = 150
  const confirmationWindows = Math.max(2, Math.ceil(acceptanceMs / strideMs))
  return {
    minimumConfidence: minimumConfidence / 100,
    waitForConfirmation: true,
    settings: {
      strideMs,
      confirmationMs: acceptanceMs,
      confirmationWindows,
      confirmationHistory: confirmationWindows + 2,
    },
  }
}

