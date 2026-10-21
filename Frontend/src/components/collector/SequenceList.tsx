import { getEvaluationTaskTitle } from '../../services/dataset/boundaryEvaluation'
import { memo } from 'react'
import { Download, FolderArchive, Loader2, Trash2 } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'
import { LabeledSequence } from '../../types/dataset'
import TrainingPackageExport from './TrainingPackageExport'
import PendingVideoRecordings, { type PreservedVideoTake } from './PendingVideoRecordings'

interface SequenceListProps {
  pendingVideos?: PreservedVideoTake[]
  pendingLocked?: boolean
  onProcessVideos?: () => void
  onRemoveVideo?: (id: string) => void
  collapsible?: boolean
  sequences: LabeledSequence[]
  onDelete: (id: string) => void
  onExport: () => void
  onExportZip: () => void
  onDownloadZip: () => void
  isExportingZip: boolean
  zipReady: boolean
  exportError: string | null
  onClearAll: () => void
}

// Wrapped in memo: during a recording session every prop here
// (sequences/onDelete/onExport/onExportZip/onClearAll) stays
// reference-stable tick to tick (the callbacks are useCallback'd in
// useDatasetRecorder, sequences only changes on save/delete) - without
// memo, this whole list still gets rebuilt on every detection tick purely
// because its sibling (RecordingControls) re-renders, which is wasted
// work that competes with the detection loop for main-thread time.
function SequenceList({ collapsible = false, sequences, onDelete, onExport, onExportZip, onDownloadZip, isExportingZip, zipReady, exportError, onClearAll,
  pendingVideos = [], pendingLocked = false, onProcessVideos = () => {}, onRemoveVideo = () => {} }: SequenceListProps) {
  const content = <>
      {pendingVideos.length > 0 && <PendingVideoRecordings recordings={pendingVideos} locked={pendingLocked} onProcessAll={onProcessVideos} onRemove={onRemoveVideo} />}
      {sequences.length > 0 && <details className="mb-3 text-sm"><summary className="cursor-pointer font-semibold text-text-2">Sample exports and storage</summary>
        <div className="flex gap-2 flex-wrap mt-3">
          <Button size="sm" onClick={onExport} disabled={sequences.length === 0} title="Export saved landmark samples; pending videos are excluded.">
            <Download size={13} /> Export JSON
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={zipReady ? onDownloadZip : onExportZip}
            disabled={sequences.length === 0 || isExportingZip}
            aria-busy={isExportingZip}
            title="Export saved landmark samples in this mode; pending videos are excluded."
          >
            {isExportingZip ? <Loader2 size={13} className="animate-spin" /> : <FolderArchive size={13} />}
            {isExportingZip ? 'Preparing ZIP…' : zipReady ? 'Download ZIP' : 'Prepare ZIP'}
          </Button>
          <Button size="sm" variant="danger" onClick={onClearAll} disabled={sequences.length === 0} title="Clear saved landmark samples; pending videos remain.">
            {pendingVideos.length ? 'Clear saved samples' : 'Clear all'}
          </Button>
        </div>
      {sequences.length > 0 && (
        <p className="text-sm text-text-2 mb-3" role="status">
          {isExportingZip
            ? 'Preparing all saved samples. Download ZIP will appear when ready.'
            : zipReady
              ? 'ZIP ready. Click Download ZIP to save it; you can download it again at any time.'
              : 'Prepare ZIP, then click Download ZIP. Both export formats include all saved samples.'}
        </p>
      )}
      </details>}
      {exportError && <p role="alert" className="text-sm text-danger mb-3">{exportError}</p>}
      <TrainingPackageExport sequences={sequences} />

      {sequences.length === 0 && pendingVideos.length === 0 ? (
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
