import { DatasetExportFile, ExportedSequence, LabeledSequence } from '../../types/dataset'
import { buildFeatureSchema, toFeatureVector } from '../landmarks/normalize'

// Applies the normalization pipeline to every stored (raw) frame and
// assembles the full export payload - this is the one place raw landmarks
// become the fixed-length feature vectors a GRU/LSTM training script
// expects, per ExportedFrame.
export function buildDatasetExport(sequences: LabeledSequence[]): DatasetExportFile {
  const exportedSequences: ExportedSequence[] = sequences.map((seq) => ({
    id: seq.id,
    label: seq.label,
    createdAt: seq.createdAt,
    durationMs: seq.durationMs,
    frameCount: seq.frames.length,
    frames: seq.frames.map((frame) => {
      const { features, valid } = toFeatureVector(frame.raw)
      return { timestamp: frame.timestamp, features, valid, raw: frame.raw }
    }),
  }))

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    labels: Array.from(new Set(sequences.map((s) => s.label))).sort(),
    sequenceCount: sequences.length,
    featureSchema: buildFeatureSchema(),
    sequences: exportedSequences,
  }
}

// Triggers a browser download of the dataset as JSON - same
// Blob/createObjectURL pattern HistoryPage.tsx uses for session export, so
// there's one download convention across the app.
export function downloadDatasetExport(sequences: LabeledSequence[]): void {
  const payload = buildDatasetExport(sequences)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `signsync-dataset-${Date.now()}.json`
  link.click()
  URL.revokeObjectURL(url)
}
