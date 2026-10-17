import { useEffect, useMemo, useRef, useState } from 'react'
import { useDatasetRecorder } from '../../hooks/useDatasetRecorder'
import type { TrainingCategory } from '../../types/dataset'
import { getTrainingTasks, nextTrainingTask, trainingTaskCount } from '../../services/dataset/trainingCollection'
import Card from '../shared/Card'
import PageHeader from '../layout/PageHeader'
import CollectorCameraPreview from './CollectorCameraPreview'
import RecordingControls from './RecordingControls'
import CameraDiagnostics from './CameraDiagnostics'
import SequenceList from './SequenceList'

const categories: { id: TrainingCategory; title: string }[] = [
  { id: 'rest', title: 'Resting postures' }, { id: 'idle_movement', title: 'Idle movements' },
]

export default function BoundarySampleCollector({ onLocked }: { onLocked: (locked: boolean) => void }) {
  const [category, setCategory] = useState<TrainingCategory>('rest')
  const [durations, setDurations] = useState<Partial<Record<TrainingCategory, number>>>({})
  const [selectedTasks, setSelectedTasks] = useState<Partial<Record<TrainingCategory, string>>>({})
  const tasks = useMemo(() => getTrainingTasks(undefined, category), [category])
  const task = tasks.find(item => item.id === selectedTasks[category]) ?? tasks[0]
  const recorder = useDatasetRecorder({
    scope: 'training', trainingCategory: category,
    recordingAllowed: !!task,
    durationLimitMs: durations[category],
    training: task ? {
      protocol: 'separate-training-v1',
      category, taskId: task.id, taskTitle: task.title, variantId: task.variantId, pace: task.pace,
    } : undefined,
  })
  const locked = recorder.isRecording || recorder.countdown !== null
  useEffect(() => { onLocked(locked); return () => onLocked(false) }, [locked, onLocked])
  useEffect(() => { if (task) recorder.setSelectedLabel(task.label) }, [task?.label, recorder.setSelectedLabel])
  const handledSave = useRef<string | null>(null)
  useEffect(() => {
    const saved = recorder.lastSavedSequence
    if (!saved || handledSave.current === saved.id) return
    handledSave.current = saved.id
    if (!saved.training) return
    const savedCategory = saved.training.category
    const next = nextTrainingTask(getTrainingTasks(undefined, savedCategory), recorder.sequences, undefined, saved.training.taskId)
    setSelectedTasks(previous => ({ ...previous, [savedCategory]: next }))
  }, [recorder.lastSavedSequence, recorder.sequences])
  const count = (id: string) => trainingTaskCount(recorder.sequences, undefined, id)
  const complete = tasks.reduce((sum, item) => sum + Math.min(count(item.id), item.target ?? 0), 0)
  const target = tasks.reduce((sum, item) => sum + (item.target ?? 0), 0)

  return <div className="space-y-4">
    <PageHeader title="Rest and Idle Collector" description="Collect resting postures and idle movements for training alongside your existing sign recordings. Select a category and task, then start recording." />
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)] gap-4 items-start">
      <div className="min-w-0 space-y-4">
        <CollectorCameraPreview feed={recorder.feed} countdown={recorder.countdown} />
        <Card>
          <fieldset disabled={locked}>
            <legend className="font-semibold mb-2">{categories.find(item => item.id === category)?.title} checklist</legend>
            <p className="text-sm text-text-2 mb-3">Click a task, then Start recording. Saved takes fill the checklist; the next incomplete task is selected automatically.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">{tasks.map(item => <button key={item.id} type="button" aria-pressed={task?.id === item.id}
              onClick={() => setSelectedTasks(previous => ({ ...previous, [category]: item.id }))}
              className={`border rounded-lg p-3 text-left disabled:opacity-50 ${task?.id === item.id ? 'border-signal bg-signal-light' : 'border-border'}`}>
              <span className="block text-sm font-semibold">{item.title}</span>
              <span className="text-xs text-text-2">{item.target === null ? 'Unlimited takes' : <>{count(item.id) >= item.target ? '✓ ' : ''}{count(item.id)}/{item.target} saved</>}</span>
            </button>)}</div>
            <p role="status" className="text-sm font-semibold mt-3">{complete}/{target} checklist takes complete. Extra takes are allowed.{category === 'idle_movement' && ' General idle has no quota and stays selected after saving.'}</p>
          </fieldset>
          {category === 'rest' && <details className="mt-4"><summary className="cursor-pointer text-sm font-semibold">View resting posture and palm guides</summary>
            <img src="/guides/idle-hand/half-body-resting-postures-v1.png" alt="Resting hands beside torso, near waist and in front" loading="lazy" className="mt-3 w-full rounded-lg" />
            <img src="/guides/idle-hand/palm-orientation-v1.png" alt="Natural and open-palm resting orientations" loading="lazy" className="mt-3 w-full rounded-lg" />
            <img src="/guides/idle-hand/one-hand-idle-posture.png" alt="One-handed resting posture" loading="lazy" className="mt-3 w-full rounded-lg" />
          </details>}
        </Card>
      </div>
      <div className="space-y-4">
        <Card><div className="space-y-4">
          <div className="flex gap-2" role="group" aria-label="Boundary sample category">{categories.map(item => <button key={item.id} type="button" disabled={locked} aria-pressed={category === item.id}
            onClick={() => setCategory(item.id)} className={`flex-1 rounded-lg border px-2 py-3 text-sm font-semibold disabled:opacity-50 ${category === item.id ? 'border-signal bg-signal-light' : 'border-border text-text-2'}`}>{item.title}</button>)}</div>
          <p className="text-sm font-semibold">{task?.title}</p>
          <p className="text-sm text-text-2">{task?.instruction}</p>
          <RecordingControls isRecording={recorder.isRecording} frameCount={recorder.frameCount} processedFramesRef={recorder.processedFramesRef}
            durationLimitMs={durations[category]} onChangeDurationLimitMs={duration => setDurations(previous => ({ ...previous, [category]: duration }))}
            canRecord={!!task && recorder.feed.enabled && recorder.feed.cameraReady}
            countdown={recorder.countdown} countdownSeconds={recorder.countdownSeconds} onChangeCountdownSeconds={recorder.setCountdownSeconds}
            onStart={recorder.startRecording} onCancelCountdown={recorder.cancelCountdown} onStop={recorder.stopRecording} onDiscard={recorder.discardRecording} />
          <CameraDiagnostics feed={recorder.feed} detectionInputWidth={recorder.detectionInputWidth} onChangeInputWidth={recorder.setDetectionInputWidth} locked={locked} />
          {!recorder.feed.enabled && <p className="text-sm text-text-2">Start the camera above before recording a sample.</p>}
          {recorder.saveError && <p role="alert" className="text-sm text-danger">{recorder.saveError}</p>}
        </div></Card>
        <p className="text-xs text-text-2">Saved samples, exports and Clear all apply to this category.</p>
        <SequenceList sequences={recorder.sequences} onDelete={recorder.removeSequence} onExport={recorder.exportDataset} onExportZip={recorder.exportPerSampleZip}
          onDownloadZip={recorder.downloadZip} isExportingZip={recorder.isExportingZip} zipReady={recorder.zipReady} exportError={recorder.exportError} onClearAll={recorder.clearAll} />
      </div>
    </div>
  </div>
}
