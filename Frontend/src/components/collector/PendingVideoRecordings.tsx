import type { TrainingCollectionMetadata } from '../../types/dataset'
import { triggerDownload } from '../../services/dataset/datasetExport'
import Button from '../shared/Button'

export type PreservedVideoTake = {
  id: string; file: File; label: string; fps: number; training?: TrainingCollectionMetadata
}

export default function PendingVideoRecordings({ recordings, locked, onProcessAll, onRemove }: {
  recordings: PreservedVideoTake[]; locked: boolean; onProcessAll: () => void; onRemove: (id: string) => void
}) {
  if (!recordings.length) return null
  return <div className="space-y-3 mb-4" aria-label="Pending camera recordings">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm font-semibold" role="status">{recordings.length} waiting to process</p>
      <Button size="sm" variant="primary" disabled={locked || !recordings.length} onClick={onProcessAll}>Process all</Button>
    </div>
      <p className="text-xs text-text-2">Download originals before leaving this page.</p>
      <ul className="space-y-2 max-h-80 overflow-auto overscroll-contain">{recordings.map(take => <li key={take.id} className="rounded-lg border border-border p-3 space-y-2">
        <p className="text-sm font-semibold break-all">{take.file.name} · {take.label}</p>
        <p className="text-xs font-semibold text-text-2">Waiting to process</p>
        {take.training && <p className="text-xs text-text-2">{take.training.taskTitle}</p>}
        <div className="flex flex-wrap gap-3">
          <Button size="sm" onClick={() => triggerDownload(take.file, take.file.name)}>Download original video</Button>
          <Button size="sm" variant="danger" disabled={locked} onClick={() => onRemove(take.id)}>Remove recording</Button>
        </div>
      </li>)}</ul>
  </div>
}
