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
//
// `label` names the file after whatever sign is currently selected in the
// collector at export time (e.g. "signsync-dataset-hello-2026-09-05.json")
// so batches stay identifiable at a glance in your downloads folder - it
// does not filter which sequences get exported, every recorded sample
// still goes into the file regardless of label.
export function downloadDatasetExport(sequences: LabeledSequence[], label?: string): void {
  const payload = buildDatasetExport(sequences)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const slug = (label ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
  const dateStamp = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const filename = slug
    ? `signsync-dataset-${slug}-${Date.now()}.json`
    : `signsync-dataset-${Date.now()}.json`

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}