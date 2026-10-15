import type { IdleCollectionMetadata, LabeledSequence } from '../../types/dataset'

export const IDLE_LABEL = 'IDLE'
export const IDLE_DURATION_MS = 3000
export const IDLE_HANDS = [
  { value: 'left', title: 'Left hand only', instruction: 'Keep your left hand visible and relaxed. Move your right hand comfortably outside the frame.' },
  { value: 'right', title: 'Right hand only', instruction: 'Keep your right hand visible and relaxed. Move your left hand comfortably outside the frame.' },
  { value: 'both', title: 'Both hands', instruction: 'Keep both hands visible and relaxed, in the same position, with a gap between them.' },
] as const
export const IDLE_POSTURES = [
  { value: 'beside_torso', title: 'Beside torso', instruction: 'Rest beside your torso. Bend the elbow slightly if needed to keep all fingers in frame.' },
  { value: 'near_waist', title: 'Near waist', instruction: 'Bend the elbow comfortably and rest the hand beside your waist.' },
  { value: 'in_front', title: 'In front', instruction: 'Rest in front of your lower abdomen. Keep hands separate and avoid overlapping them.' },
] as const

export const IDLE_VARIATIONS = IDLE_HANDS.flatMap(hand => IDLE_POSTURES.map(posture => ({
  id: `IDLE_${hand.value.toUpperCase()}_${posture.value.toUpperCase()}`,
  title: `${hand.title} · ${posture.title}`,
  hands: hand.value,
  posture: posture.value,
  instruction: `${hand.instruction} ${posture.instruction}`,
})))

export function createIdleMetadata(variationId?: string): IdleCollectionMetadata | undefined {
  if (variationId === undefined) {
    return { kind: 'idle', protocol: 'idle-v1', targetDurationMs: IDLE_DURATION_MS }
  }
  const variation = IDLE_VARIATIONS.find(item => item.id === variationId)
  if (!variation) return undefined
  return {
    kind: 'idle', protocol: 'idle-v1',
    hands: variation.hands, posture: variation.posture, palmOrientation: 'natural',
    targetDurationMs: IDLE_DURATION_MS,
  }
}

// Interpret the original nine idle labels as variations of one class, without
// discarding old participant/session metadata or mutating the stored recording.
export function normalizeIdleSequence(sequence: LabeledSequence): LabeledSequence {
  const legacyMetadata = createIdleMetadata(sequence.label)
  if (!legacyMetadata) return sequence
  return { ...sequence, label: IDLE_LABEL, collection: sequence.collection ?? legacyMetadata }
}
