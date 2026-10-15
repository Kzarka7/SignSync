import { memo } from 'react'
import { Download, FolderArchive, Loader2, Trash2 } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'
import { LabeledSequence } from '../../types/dataset'

interface SequenceListProps {
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
function SequenceList({ sequences, onDelete, onExport, onExportZip, onDownloadZip, isExportingZip, zipReady, exportError, onClearAll }: SequenceListProps) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3.5 gap-2 flex-wrap">
        <h3 className="text-md uppercase tracking-wide text-text-2 font-semibold">
          Recorded samples ({sequences.length})
        </h3>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="primary" onClick={onExport} disabled={sequences.length === 0}>
            <Download size={13} /> Export JSON
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={zipReady ? onDownloadZip : onExportZip}
            disabled={sequences.length === 0 || isExportingZip}
            aria-busy={isExportingZip}
            title="All saved samples, with one JSON file per sample"
          >
            {isExportingZip ? <Loader2 size={13} className="animate-spin" /> : <FolderArchive size={13} />}
            {isExportingZip ? 'Preparing ZIP…' : zipReady ? 'Download ZIP' : 'Prepare ZIP'}
          </Button>
          <Button size="sm" variant="danger" onClick={onClearAll} disabled={sequences.length === 0}>
            Clear all
          </Button>
        </div>
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
      {exportError && <p role="alert" className="text-sm text-danger mb-3">{exportError}</p>}

      {sequences.length === 0 ? (
        <p className="text-sm text-text-2">No samples recorded yet. Pick a label and start recording.</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-80 overflow-y-auto custom-scrollbar pr-1">
          {sequences.map((seq) => (
            <div
              key={seq.id}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-sky border border-border"
            >
              <div>
                <div className="text-sm font-semibold">{seq.label}</div>
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
                className="text-text-2 hover:text-danger transition-colors p-1.5"
                title="Delete sample"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

export default memo(SequenceList)
