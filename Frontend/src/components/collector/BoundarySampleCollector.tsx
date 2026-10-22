import { useEffect, useMemo, useRef, useState } from 'react'
import { useDatasetRecorder } from '../../hooks/useDatasetRecorder'
import type { LabeledSequence, TrainingCategory, TrainingCollectionMetadata } from '../../types/dataset'
import { getTrainingTasks, nextTrainingTask, trainingTaskCount } from '../../services/dataset/trainingCollection'
import { getSequences } from '../../services/dataset/datasetStorage'
import Card from '../shared/Card'
import PageHeader from '../layout/PageHeader'
import CollectorCameraPreview from './CollectorCameraPreview'
import RecordingControls from './RecordingControls'
import CameraDiagnostics from './CameraDiagnostics'
import SequenceList from './SequenceList'
import VideoUploadCollector from './VideoUploadCollector'
import CameraVideoRecorder from './CameraVideoRecorder'

const categories: { id: TrainingCategory; title: string }[] = [
  { id: 'rest', title: 'Resting postures' }, { id: 'idle_movement', title: 'Idle movements' },
]
type Incoming = { id: string; file: File; label: string; fps: number; training: TrainingCollectionMetadata }

export default function BoundarySampleCollector({ onLocked }: { onLocked: (locked: boolean) => void }) {
  const [category, setCategory] = useState<TrainingCategory>('rest')
  const [mode, setMode] = useState<'camera' | 'upload'>('camera')
  const [cameraMethod, setCameraMethod] = useState<'video' | 'live'>('video')
  const [uploadBusy, setUploadBusy] = useState(false), [cameraBusy, setCameraBusy] = useState(false)
  const [videoControls, setVideoControls] = useState<HTMLDivElement | null>(null)
  const [incoming, setIncoming] = useState<Incoming[]>([])
  const [pendingVideos, setPendingVideos] = useState<Incoming[]>([])
  const [allSequences, setAllSequences] = useState(getSequences)
  const [durations, setDurations] = useState<Partial<Record<TrainingCategory, number>>>({})
  const [selectedTasks, setSelectedTasks] = useState<Partial<Record<TrainingCategory, string>>>({})
  const tasks = useMemo(() => getTrainingTasks(undefined, category), [category])
  const task = tasks.find(item => item.id === selectedTasks[category]) ?? tasks[0]
  const training: TrainingCollectionMetadata | undefined = task ? {
    protocol: 'separate-training-v1', category, taskId: task.id, taskTitle: task.title, variantId: task.variantId, pace: task.pace,
  } : undefined
  const recorder = useDatasetRecorder({ scope: 'training', trainingCategory: category, recordingAllowed: !!task,
    durationLimitMs: durations[category], training })
  const locked = recorder.isRecording || recorder.countdown !== null || uploadBusy || cameraBusy
  useEffect(() => { onLocked(locked); return () => onLocked(false) }, [locked, onLocked])
  useEffect(() => { if (task) recorder.setSelectedLabel(task.label) }, [task?.label, recorder.setSelectedLabel])
  // Queue ownership spans both categories; switching categories must not undo saves.
  useEffect(() => { setAllSequences(getSequences()) }, [recorder.sequences])
  const refresh = () => { setAllSequences(getSequences()); recorder.refreshSequences() }
  const advance = (saved: LabeledSequence) => {
    if (!saved.training) return
    const savedCategory = saved.training.category
    const next = nextTrainingTask(getTrainingTasks(undefined, savedCategory), getSequences(), undefined, saved.training.taskId)
    setSelectedTasks(previous => ({ ...previous, [savedCategory]: next }))
  }
  const handledSave = useRef<string | null>(null)
  useEffect(() => {
    const saved = recorder.lastSavedSequence
    if (!saved || handledSave.current === saved.id) return
    handledSave.current = saved.id; advance(saved)
  }, [recorder.lastSavedSequence])
  const count = (id: string) => trainingTaskCount(recorder.sequences, undefined, id)
  const complete = tasks.reduce((sum, item) => sum + Math.min(count(item.id), item.target ?? 0), 0)
  const target = tasks.reduce((sum, item) => sum + (item.target ?? 0), 0)
  const settings = <Card><div className="space-y-4">
    <fieldset disabled={locked} className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="Boundary sample category">{categories.map(item => <button key={item.id} type="button" aria-pressed={category === item.id}
        onClick={() => setCategory(item.id)} className={`flex-1 rounded-lg border px-2 py-3 text-sm font-semibold disabled:opacity-50 ${category === item.id ? 'border-signal bg-signal-light' : 'border-border text-text-2'}`}>{item.title}</button>)}</div>
      <label className="block text-sm font-semibold">Collection task
        <select aria-label="Collection task" className="block w-full border border-border rounded-lg p-2 mt-2" value={task?.id ?? ''}
          onChange={event => setSelectedTasks(previous => ({ ...previous, [category]: event.target.value }))}>
          {tasks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <p className="text-sm text-text-2">{task?.instruction}</p>
      <div><p className="text-sm font-semibold text-text-2 mb-2.5">Collection source</p>
        <div role="group" aria-label="Collection source" className="inline-flex gap-1 rounded-lg bg-sky border border-border p-1">
          {(['camera', 'upload'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value}
            onClick={() => { if (value === 'upload' && recorder.feed.enabled) recorder.feed.toggleCamera(); setMode(value) }}
            className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${mode === value ? 'bg-white text-ink shadow-sm ring-1 ring-border' : 'text-text-2 hover:bg-white'}`}>
            {value === 'camera' ? 'Camera' : 'Upload videos'}
          </button>)}
        </div>
      </div>
      <details><summary className="cursor-pointer text-sm font-semibold">Task checklist · {complete}/{target}</summary>
        <div className="grid gap-2 mt-3">{tasks.map(item => <button key={item.id} type="button" aria-pressed={task?.id === item.id}
          onClick={() => setSelectedTasks(previous => ({ ...previous, [category]: item.id }))}
          className={`border rounded-lg p-3 text-left disabled:opacity-50 ${task?.id === item.id ? 'border-signal bg-signal-light' : 'border-border'}`}>
          <span className="block text-sm font-semibold">{item.title}</span>
          <span className="text-xs text-text-2">{item.target === null ? 'Unlimited takes' : `${count(item.id)}/${item.target} saved`}</span>
        </button>)}</div>
        <p role="status" className="text-xs text-text-2 mt-3">Extra takes are allowed.{category === 'idle_movement' && ' General idle has no quota.'}</p>
      </details>
    </fieldset>
    {category === 'rest' && <details><summary className="cursor-pointer text-sm font-semibold">Resting posture guides</summary>
      <img src="/guides/idle-hand/half-body-resting-postures-v1.png" alt="Resting hands beside torso, near waist and in front" loading="lazy" className="mt-3 w-full rounded-lg" />
      <img src="/guides/idle-hand/palm-orientation-v1.png" alt="Natural and open-palm resting orientations" loading="lazy" className="mt-3 w-full rounded-lg" />
      <img src="/guides/idle-hand/one-hand-idle-posture.png" alt="One-handed resting posture" loading="lazy" className="mt-3 w-full rounded-lg" />
    </details>}
  </div></Card>
  const recordedSamples = <SequenceList collapsible sequences={recorder.sequences} onDelete={recorder.removeSequence} onExportZip={recorder.exportPerSampleZip}
    pendingVideos={pendingVideos} pendingLocked={locked} onRemoveVideo={id => setPendingVideos(previous => previous.filter(take => take.id !== id))}
    onProcessVideos={() => {
      if (locked || !pendingVideos.length) return
      setIncoming(previous => [...previous, ...pendingVideos])
      if (recorder.feed.enabled) recorder.feed.toggleCamera()
      setPendingVideos([]); setMode('upload')
    }}
    onDownloadZip={recorder.downloadZip} isExportingZip={recorder.isExportingZip} zipReady={recorder.zipReady} exportError={recorder.exportError} onClearAll={recorder.clearAll} />

  return <div>
    <PageHeader title="Rest and Idle Collector" description="Choose a non-sign task, add recordings, then review and save each take." />
    <div hidden={mode !== 'upload'}>
      <VideoUploadCollector label={task?.label ?? ''} training={training} sequences={allSequences} controls={settings} recordedSamples={recordedSamples}
        incoming={incoming} onIncomingConsumed={ids => setIncoming(previous => previous.filter(item => !ids.includes(item.id)))}
        onSaved={refresh} onSampleSaved={advance} onBusy={setUploadBusy} />
    </div>
    {mode === 'camera' && <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(340px,1fr)] gap-4 items-start">
      <div className="min-w-0 space-y-4">
      {cameraMethod === 'video' ? <CameraVideoRecorder label={task?.label ?? ''} onBusy={setCameraBusy} controlsContainer={videoControls}
        countdownSeconds={recorder.countdownSeconds} onChangeCountdownSeconds={recorder.setCountdownSeconds}
        durationLimitMs={durations[category]} onChangeDurationLimitMs={duration => setDurations(previous => ({ ...previous, [category]: duration }))}
        onRecorded={(file, label, fps) => {
          if (!training) return
          setPendingVideos(previous => [...previous, { id: crypto.randomUUID(), file, label, fps, training: { ...training } }])
        }} /> : <CollectorCameraPreview feed={recorder.feed} countdown={recorder.countdown} />}
      </div>
      <div className="space-y-4">{settings}
        <Card><div className="space-y-4">
          <label className="block text-sm">Camera collection method
            <select aria-label="Camera collection method" className="block border rounded p-2 w-full" disabled={locked} value={cameraMethod}
              onChange={event => { if (recorder.feed.enabled) recorder.feed.toggleCamera(); setCameraMethod(event.target.value as 'video' | 'live') }}>
              <option value="video">Preserve video, process afterward</option><option value="live">Live landmarks (existing workflow)</option>
            </select>
          </label>
          {cameraMethod === 'video' && <div ref={setVideoControls} />}
          {cameraMethod === 'live' && <>
            <RecordingControls isRecording={recorder.isRecording} frameCount={recorder.frameCount} processedFramesRef={recorder.processedFramesRef}
              durationLimitMs={durations[category]} onChangeDurationLimitMs={duration => setDurations(previous => ({ ...previous, [category]: duration }))}
              canRecord={!!task && recorder.feed.enabled && recorder.feed.cameraReady}
              countdown={recorder.countdown} countdownSeconds={recorder.countdownSeconds} onChangeCountdownSeconds={recorder.setCountdownSeconds}
              onStart={recorder.startRecording} onCancelCountdown={recorder.cancelCountdown} onStop={recorder.stopRecording} onDiscard={recorder.discardRecording} />
            <CameraDiagnostics feed={recorder.feed} detectionInputWidth={recorder.detectionInputWidth} onChangeInputWidth={recorder.setDetectionInputWidth} locked={locked} />
            {recorder.saveError && <p role="alert" className="text-sm text-danger">{recorder.saveError}</p>}
          </>}
        </div></Card>
        {recordedSamples}
      </div>
    </div>}
  </div>
}
