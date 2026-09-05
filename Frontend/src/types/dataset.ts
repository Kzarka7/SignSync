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

// One recorded example of a single sign: a labeled, time-ordered sequence
// of frames from a single Start -> Stop recording.
export interface LabeledSequence {
  id: string
  label: string
  createdAt: string // ISO timestamp
  durationMs: number
  frames: DatasetFrame[]
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
  id: string
  label: string
  createdAt: string
  durationMs: number
  frameCount: number
  frames: ExportedFrame[]
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
