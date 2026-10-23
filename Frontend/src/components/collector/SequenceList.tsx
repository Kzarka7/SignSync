import { getEvaluationTaskTitle } from '../../services/dataset/boundaryEvaluation'
import { memo, useEffect, useState } from 'react'
import { FolderArchive, Loader2, Trash2 } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'
import { LabeledSequence } from '../../types/dataset'
import PendingVideoRecordings, { type PreservedVideoTake } from './PendingVideoRecordings'

interface SequenceListProps {
  isLoading?: boolean
  storageBusy?: boolean
  storageError?: string | null
  onRetry?: () => void
  pendingVideos?: PreservedVideoTake[]
  pendingLocked?: boolean
  onProcessVideos?: () => void
  onRemoveVideo?: (id: string) => void
  collapsible?: boolean
  sequences: LabeledSequence[]
  onDelete: (id: string) => void
  onExportZip: () => void
  onDownloadZip: () => void
  isExportingZip: boolean
  zipReady: boolean
  exportError: string | null
  onClearAll: () => void
}

// Wrapped in memo: during a recording session every prop here
// (sequences/onDelete/onExportZip/onClearAll) stays
// reference-stable tick to tick (the callbacks are useCallback'd in
// useDatasetRecorder, sequences only changes on save/delete) - without
// memo, this whole list still gets rebuilt on every detection tick purely
// because its sibling (RecordingControls) re-renders, which is wasted
// work that competes with the detection loop for main-thread time.
function SequenceList({ isLoading = false, storageBusy = false, storageError, onRetry, collapsible = false, sequences, onDelete, onExportZip, onDownloadZip, isExportingZip, zipReady, exportError, onClearAll,
  pendingVideos = [], pendingLocked = false, onProcessVideos = () => {}, onRemoveVideo = () => {} }: SequenceListProps) {
  const [capacity, setCapacity] = useState('')
  useEffect(() => {
    let active = true
    if (navigator.storage?.estimate) void navigator.storage.estimate().then(({ usage, quota }) => {
      if (active && usage !== undefined && quota !== undefined) setCapacity(`Browser storage: ${(usage / 1048576).toFixed(1)} MB used  |  approximately ${(Math.max(0, quota - usage) / 1048576).toFixed(1)} MB available across this site.`)
    }).catch(() => {})
    return () => { active = false }
  }, [sequences])
  const content = <>
      {isLoading && <p role="status">Loading saved samples...</p>}
      {storageBusy && <p role="status">Saving changes...</p>}
      {storageError && <p role="alert" className="text-sm text-danger">{storageError} <button onClick={onRetry}>Retry loading samples</button></p>}
      {capacity && <p className="text-xs text-text-2 mb-3">{capacity} Capacity varies; export backups regularly.</p>}
      {pendingVideos.length > 0 && <PendingVideoRecordings recordings={pendingVideos} locked={pendingLocked} onProcessAll={onProcessVideos} onRemove={onRemoveVideo} />}
      {sequences.length > 0 && <div className="mb-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={zipReady ? onDownloadZip : onExportZip}
          disabled={isLoading || storageBusy || isExportingZip}
          aria-busy={isExportingZip}
          title="Download one JSON file per saved sample in a ZIP. Pending videos are excluded."
        >
          {isExportingZip ? <Loader2 size={13} className="animate-spin" /> : <FolderArchive size={13} />}
          {isExportingZip ? 'Preparing ZIP' : zipReady ? 'Export as ZIP' : 'Prepare ZIP'}
        </Button>
        <Button size="sm" variant="danger" disabled={isLoading || storageBusy} onClick={onClearAll} title="Clear all saved landmark samples; pending videos remain.">
          Clear all
        </Button>
        </div>
        <p className="text-sm text-text-2" role="status">
          {isExportingZip
            ? 'Preparing one JSON file per saved sample.'
            : zipReady
              ? 'ZIP ready. Click Export as ZIP to download one JSON file per sample.'
              : 'Export saved samples as a ZIP containing one JSON file per sample. Pending videos are excluded.'}
        </p>
      </div>}
      {exportError && <p role="alert" className="text-sm text-danger mb-3">{exportError}</p>}

      {!isLoading && !storageError && sequences.length === 0 && pendingVideos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-sky p-4"><p className="text-sm font-semibold">No saved samples yet</p><p className="text-xs text-text-2 mt-1">Record a take or save a reviewed sample.</p></div>
      ) : sequences.length > 0 && (
        <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto custom-scrollbar pr-1">
          {sequences.map((seq) => (
            <div
              key={seq.id}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-sky border border-border"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold">{seq.label === 'IDLE_MOVEMENT' ? 'IDLE' : seq.label}</div>
                {seq.training && <div className="text-xs text-text-2">{seq.training.taskTitle}{seq.training.participantId && ` | ${seq.training.participantId}`}</div>}
                {seq.evaluation && <div className="text-xs text-text-2">{getEvaluationTaskTitle(seq.evaluation.taskId)}</div>}
                {seq.videoImport && <div className="text-xs text-text-2 truncate" title={seq.videoImport.filename}>Imported{seq.videoImport.participantId && ` · ${seq.videoImport.participantId}`} · {seq.videoImport.filename} · {seq.videoImport.quality.result}</div>}
                {seq.videoImport && <div className="text-xs text-text-2">{seq.videoImport.review ? 'Training review saved' : 'Needs training review'}</div>}
                {seq.collection?.hands && seq.collection.posture && (
                  <div className="text-xs text-text-2">
                    {seq.collection.hands === 'both' ? 'Both hands' : seq.collection.hands === 'left' ? 'Left hand only' : 'Right hand only'}
                    {' · '}{seq.collection.posture === 'beside_torso' ? 'Beside torso' : seq.collection.posture === 'near_waist' ? 'Near waist' : 'In front'}
                  </div>
                )}
                <div className="text-xs text-text-2">
                  {seq.frames.length} frames · {(seq.durationMs / 1000).toFixed(1)}s ·{' '}
                  <span className="tabular-nums" title="Average processed FPS from the first to the last saved frame">
                    {seq.frames.length > 1 && Number.isFinite(seq.durationMs) && seq.durationMs > 0
                      ? ((seq.frames.length - 1) * 1000 / seq.durationMs).toFixed(1)
                      : '—'} FPS
                  </span> ·{' '}
                  {new Date(seq.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                disabled={isLoading || storageBusy}
                onClick={() => onDelete(seq.id)}
                className="shrink-0 text-text-2 hover:text-danger transition-colors p-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
                aria-label={`Delete ${seq.label} sample`}
                title="Delete sample"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
  </>
  const title = `Recorded samples (${sequences.length + pendingVideos.length})`
  return <Card>{collapsible ? <details open>
    <summary className="cursor-pointer text-lg text-ink font-semibold">{title}</summary>
    <div className="mt-4">{content}</div>
  </details> : <>
    <h3 className="text-lg text-ink font-semibold mb-3.5">{title}</h3>
    {content}
  </>}</Card>
}

export default memo(SequenceList)
