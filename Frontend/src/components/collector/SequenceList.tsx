import { Download, Trash2 } from 'lucide-react'
import Card from '../shared/Card'
import Button from '../shared/Button'
import { LabeledSequence } from '../../types/dataset'

interface SequenceListProps {
  sequences: LabeledSequence[]
  onDelete: (id: string) => void
  onExport: () => void
  onClearAll: () => void
}

export default function SequenceList({ sequences, onDelete, onExport, onClearAll }: SequenceListProps) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3.5 gap-2">
        <h3 className="text-md uppercase tracking-wide text-text-2 font-semibold">
          Recorded samples ({sequences.length})
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={onExport} disabled={sequences.length === 0}>
            <Download size={13} /> Export
          </Button>
          <Button size="sm" variant="danger" onClick={onClearAll} disabled={sequences.length === 0}>
            Clear all
          </Button>
        </div>
      </div>

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
                <div className="text-xs text-text-2">
                  {seq.frames.length} frames · {(seq.durationMs / 1000).toFixed(1)}s ·{' '}
                  {new Date(seq.createdAt).toLocaleTimeString()}
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
