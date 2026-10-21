import { useEffect, useMemo, useRef, useState } from 'react'
import type { LabeledSequence } from '../../types/dataset'
import { buildTrainingPackage, reviewTrainingSamples } from '../../services/dataset/trainingPackage'
import { triggerDownload } from '../../services/dataset/datasetExport'
import Button from '../shared/Button'
import { isFullRecording } from '../../services/dataset/videoIntervalReview'

export default function TrainingPackageExport({ sequences }: { sequences: LabeledSequence[] }) {
  const assessments = useMemo(() => reviewTrainingSamples(sequences), [sequences])
  const ready = assessments.filter(sample => sample.state === 'Ready for training').length
  const approved = sequences.filter((_, index) => assessments[index].state === 'Ready for training')
  const fullCount = approved.filter(sample => isFullRecording(sample.videoImport!.trimStartMs / 1000, sample.videoImport!.trimEndMs / 1000, sample.videoImport!.sourceDurationMs / 1000)).length
  const [prepared, setPrepared] = useState<Awaited<ReturnType<typeof buildTrainingPackage>> | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => { generation.current++; setPrepared(null); setBusy(false); setError(''); return () => { generation.current++ } }, [sequences])
  if (!sequences.length || sequences.some(sample => sample.evaluation)) return null
  return <div className="border border-border rounded-lg p-3 space-y-2 mb-3">
    <p className="text-sm font-semibold">Training package · {ready} ready / {sequences.length} saved</p>
    <p className="text-xs text-text-2" aria-label="Training interval summary">{ready - fullCount} trimmed · {fullCount} full recordings</p>
    {approved.some(sample => !sample.videoImport?.intervalReview) && <p className="text-sm text-text-2">{approved.filter(sample => !sample.videoImport?.intervalReview).length} older saved takes have no explicit boundary choice. Revisit the originals to confirm the interval before training.</p>}
    <Button size="sm" variant="primary" disabled={!ready || busy} onClick={async () => {
      if (prepared) { try { triggerDownload(prepared.blob, prepared.filename) } catch { setError('Download failed. Try downloading the prepared package again.') } return }
      const current = generation.current
      setBusy(true); setError('')
      try { const result = await buildTrainingPackage(sequences); if (current === generation.current) setPrepared(result) }
      catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not prepare training package.') }
      finally { if (current === generation.current) setBusy(false) }
    }}>{busy ? 'Validating package…' : prepared ? 'Download training package' : 'Prepare training package'}</Button>
    {prepared && <p className="text-xs" role="status">{prepared.report.included} included · {prepared.report.excluded} excluded. Package ready to download.</p>}
    {!!assessments.some(sample => sample.state !== 'Ready for training') && <details className="text-xs"><summary className="cursor-pointer">Why samples are excluded</summary><ul className="list-disc pl-4 space-y-1">{assessments.filter(sample => sample.state !== 'Ready for training').map((sample, index) => <li key={`${sample.id}-${index}`}>{sample.label} ({sample.id.slice(0, 8)}) · {sample.state}: {sample.reasons.join(' ')}</li>)}</ul></details>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>
}
