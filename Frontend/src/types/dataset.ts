import type { LandmarkFrameSample } from './landmarks'

// One recorded video frame within a sequence - the exact synchronized
// sample useCameraFeed's onFrame callback produces, kept as-is. Storage
// stays raw (not normalized) on purpose: normalization is applied at
// export time (see services/landmarks/normalize.ts), so the pipeline can
// change later without needing to re-record every existing sample.
export interface DatasetFrame {
  timestamp: number
  raw: LandmarkFrameSample
}

export type TrainingCategory = 'sign' | 'rest' | 'idle_movement'
export interface TrainingCollectionMetadata {
  protocol: 'separate-training-v1'
  batchId?: string
  participantId?: string
  category: TrainingCategory
  taskId: string
  taskTitle: string
  variantId?: string
  pace?: string
}

export interface IdleCollectionMetadata {
  kind: 'idle' | 'rest'
  protocol: 'idle-v1' | 'rest-v1'
  // Preserve older annotations when present. New idle clips do not assign
  // participant, session, hand configuration, posture or palm orientation.
  participantId?: string
  sessionId?: string
  hands?: 'left' | 'right' | 'both'
  posture?: 'beside_torso' | 'near_waist' | 'in_front'
  palmOrientation?: 'natural'
  targetDurationMs: number
}

// One recorded example of a single sign: a labeled, time-ordered sequence
// of frames from a single Start -> Stop recording.
export interface LabeledSequence {
  training?: TrainingCollectionMetadata
  id: string
  label: string
  createdAt: string // ISO timestamp
  durationMs: number
  frames: DatasetFrame[]
  evaluation?: { protocol: 'boundary-pilot-v1'; taskId: string; participantId: string; sessionId: string; notes: string }
  collection?: IdleCollectionMetadata
}

// --- Export shape (what gets written to the downloaded dataset file) -----

// One frame as written to the exported dataset file: the normalized,
// fixed-length feature vector a GRU/LSTM would consume directly, plus the
// original raw landmarks in case a different normalization is wanted
// later without re-recording.
export interface ExportedFrame {
  timestamp: number
  // Fixed-length numeric vector - see DatasetExportFile.featureSchema for
  // exactly what each index means. Zero-filled (with valid: false) for
  // frames where pose wasn't detected or was unusable as a normalization
  // reference, so every frame in every sequence has the same length.
  features: number[]
  valid: boolean
  raw: LandmarkFrameSample
}

export interface ExportedSequence {
  training?: TrainingCollectionMetadata
  id: string
  label: string
  createdAt: string
  durationMs: number
  frameCount: number
  frames: ExportedFrame[]
  evaluation?: { protocol: 'boundary-pilot-v1'; taskId: string; participantId: string; sessionId: string; notes: string }
  collection?: IdleCollectionMetadata
}

// Documents exactly how `features` in every ExportedFrame is laid out, so
// a Python loader can build a numpy array / label the columns without
// guessing. Written once at the top of the export file rather than
// repeated per frame.
export interface FeatureSchema {
  length: number
  // One descriptive name per feature index, in order - e.g.
  // "pose.leftShoulder.x", "leftHand.wrist.y", ...
  order: string[]
  normalization: {
    method: string
    origin: string
    scale: string
  }
}

export interface DatasetExportFile {
  schemaVersion: 1
  exportedAt: string
  labels: string[]
  sequenceCount: number
  featureSchema: FeatureSchema
  sequences: ExportedSequence[]
}
