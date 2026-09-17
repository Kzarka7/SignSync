import JSZip from 'jszip'
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

function slugify(label?: string): string {
  return (label ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '')
}

// Readable and filesystem-safe (colons aren't valid in Windows filenames,
// hence hyphens instead of ISO's ':'), unique to the second - exports
// minutes apart during a record/check/re-record loop are a completely
// normal thing to do in one sitting, and anything coarser than
// down-to-the-second would silently collide for any of them.
function dateTimeStamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// Triggers a browser download of the dataset as JSON - same
// Blob/createObjectURL pattern HistoryPage.tsx uses for session export, so
// there's one download convention across the app.
//
// `label` names the file after whatever sign is currently selected in the
// collector at export time - alongside a readable date/time and the
// sample count, so exports stay distinguishable at a glance in your
// downloads folder without opening each one (e.g.
// "signsync-dataset-wave-greeting-20x-2026-09-05_15-37-05.json"). None of
// this affects which sequences get exported, every recorded sample still
// goes into the file regardless of label.
export function downloadDatasetExport(sequences: LabeledSequence[], label?: string): void {
  const payload = buildDatasetExport(sequences)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const slug = slugify(label)
  const filename = slug
    ? `signsync-dataset-${slug}-${sequences.length}x-${dateTimeStamp()}.json`
    : `signsync-dataset-${sequences.length}x-${dateTimeStamp()}.json`
  triggerDownload(blob, filename)
}

// Same data, split one sequence per file, zipped - for triaging by
// deleting individual weak-sample files instead of hand-editing one big
// JSON. Deliberately reuses buildDatasetExport's exact shape for each
// single-sequence file (schemaVersion/featureSchema/labels included, just
// with sequenceCount: 1 and one entry in `sequences`) rather than
// inventing a slimmer per-sample format - that means every file in the
// zip is independently a valid dataset export on its own, and
// merge_dataset.py (or anything else that reads a normal export) already
// knows how to read it back with zero changes: merging N of these
// one-sequence files is identical to merging N whole exports, just with
// one sequence in each instead of twenty.
export async function downloadPerSampleZipExport(
  sequences: LabeledSequence[],
  label?: string,
): Promise<void> {
  const zip = new JSZip()
  const slug = slugify(label) || 'sample'
  const pad = (n: number) => String(n).padStart(2, '0')

  // Tracks every filename actually placed in this zip so far. Not just a
  // theoretical guard: `index` alone already makes filenames unique *today*,
  // but the moment anyone reshuffles this string (drops the index, sorts
  // sequences first, whatever) two samples with the same 8-char id prefix
  // would start overwriting each other in the zip with zero warning. Keeping
  // this set turns that into a loud failure instead of a silent one.
  const usedFilenames = new Set<string>()

  sequences.forEach((seq, index) => {
    const singleSampleExport = buildDatasetExport([seq])

    // The filename's ID must come from the JSON we're actually about to
    // write, not from `seq` a second time - if a future refactor ever lets
    // those two drift apart, the shortId is what silently invalidates
    // filename-based triage/labeling. Reading it back out of
    // `singleSampleExport` (the literal object we stringify below) makes
    // that drift structurally impossible instead of just "shouldn't happen".
    const contentId = singleSampleExport.sequences[0]?.id
    if (!contentId) {
      throw new Error(
        `[downloadPerSampleZipExport] sample at index ${index} produced no id in its exported content - refusing to export a file whose name can't be trusted to match its contents.`,
      )
    }

    const shortId = contentId.slice(0, 8)
    const filename = `${slug}-${pad(index + 1)}-${shortId}.json`

    // Sanity check, kept cheap and inline so it runs on every real export
    // rather than only in a test someone has to remember to run: the ID
    // embedded in the filename must be a prefix of the ID embedded in the
    // content. If this ever throws, something upstream (id generation,
    // array reordering, a stale reference) has broken the guarantee this
    // whole naming scheme depends on.
    if (!contentId.startsWith(shortId)) {
      throw new Error(
        `[downloadPerSampleZipExport] filename/content id mismatch for sample at index ${index}: filename id "${shortId}" is not a prefix of content id "${contentId}".`,
      )
    }

    if (usedFilenames.has(filename)) {
      throw new Error(
        `[downloadPerSampleZipExport] duplicate filename "${filename}" would overwrite an earlier sample in this export - two samples produced the same slug/index/id combination.`,
      )
    }
    usedFilenames.add(filename)

    zip.file(filename, JSON.stringify(singleSampleExport, null, 2))
  })

  const blob = await zip.generateAsync({ type: 'blob' })
  const zipFilename = `signsync-dataset-${slug}-${sequences.length}x-${dateTimeStamp()}-samples.zip`
  triggerDownload(blob, zipFilename)
}