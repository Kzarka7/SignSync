import { memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronDown, Download, Film, Play, Square, Upload, Video } from 'lucide-react'
import PageHeader from '../components/layout/PageHeader'
import CameraPanel from '../components/live/CameraPanel'
import LabCaptionPreview from '../components/live/LabCaptionPreview'
import LabGlossTrack, { LabGlossSuggestions } from '../components/live/LabGlossTrack'
import { OPTIMIZED_LIVE_CAMERA_OPTIONS, useCameraFeed, type LandmarkMode, type LiveCameraTiming } from '../hooks/useCameraFeed'
import { createDiagnosticSession, FINGERSPELLING_PAUSE_MS } from '../services/landmarks/recognitionDiagnostics'
import { CONTINUOUS_SETTINGS, displayActivity } from '../services/landmarks/continuousRecognition'
import { getRecognitionConfirmation, LIVE_RECOGNITION_POLICY, LIVE_SIGNS_MODEL } from '../services/landmarks/liveRecognitionPolicy'
import { replayVideo, MAX_REPLAY_SECONDS } from '../services/landmarks/videoReplay'
import type { LabCaptionMode } from '../services/landmarks/labCaptions'
import { labGlossReport, suggestLabGlosses, type GlossAnnotation } from '../services/landmarks/labGlosses'
import { drawVideoLandmarks, previewFrame } from '../services/dataset/videoPreview'
import type { DatasetFrame } from '../types/dataset'
import type { LandmarkFrameSample } from '../types/landmarks'
import { createDiagnosticPredictor, type DiagnosticBackendInfo } from '../services/ws/diagnosticPredictor'
import Button from '../components/shared/Button'
import type { LabRecognitionMode } from '../types/message'
import type { DetectionInputWidth } from '../services/detectionInput'

type Session = ReturnType<typeof createDiagnosticSession>
type Predictor = ReturnType<typeof createDiagnosticPredictor>
type FingerspellingTrial = {
  draft: string
  recognized: string
  words: { recognized: string; confirmed: string }[]
}
const EMPTY_FINGERSPELLING: FingerspellingTrial = { draft: '', recognized: '', words: [] }
const BASELINE_LABEL = '43 Similar Signs (v1 baseline)'
const V2_MODEL = 'lab-signs43-similarity-v2'
const EXPANDED_MODEL = 'lab-signs75-multi-batch'
const STANDALONE_MODEL = 'lab-signs32-standalone'
const LAB_MODES = [
  { value: LIVE_SIGNS_MODEL, label: BASELINE_LABEL },
  { value: V2_MODEL, label: '43 Similar Signs (v2 experiment)' },
  { value: EXPANDED_MODEL, label: '75 Signs (multi-batch candidate)' },
  { value: STANDALONE_MODEL, label: '32 Signs (standalone candidate)' },
  { value: 'lab-signs32-similarity', label: '32 Signs (similarity recipe)' },
  { value: 'p4-candidate', label: 'P4 experimental' },
  { value: 'lab-signs33', label: '33 signs · days of the week' },
  { value: 'lab-signs43-numbers', label: '43 signs · days and numbers' },
  { value: 'lab-signs43-shape-motion', label: '43 signs · handshape and motion' },
  { value: 'lab-alphabet', label: 'Alphabet A–Z' },
] as const satisfies readonly { value: LabRecognitionMode | 'p4-candidate'; label: string }[]
type VisibleLabMode = (typeof LAB_MODES)[number]['value']
type PinnedBaseline = {
  modelMode: typeof LIVE_SIGNS_MODEL | typeof STANDALONE_MODEL
  recognizerId: string
  source: 'video' | 'camera'
  durationMs: number
  settings: ReturnType<Session['report']>['settings']
  minimumConfidence: number | null
  transcript: Session['state']['transcript']
  captionMode: LabCaptionMode
  gloss: ReturnType<typeof labGlossReport>
}

const selectClass = 'min-h-10 w-full rounded-lg border border-border bg-white px-2.5 text-sm text-ink disabled:bg-sky disabled:text-text-2'
const actionClass = 'min-h-10 justify-center disabled:opacity-50 disabled:cursor-not-allowed'

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatMs(value: number | null | undefined) {
  return value == null ? '—' : `${value.toFixed(1)} ms`
}

function ConfirmedSigns({ transcript, durationMs }: { transcript: Session['state']['transcript']; durationMs?: number }) {
  return <>
    {durationMs !== undefined && <p className="mb-2 text-xs text-text-2">
      {transcript.length} accepted · {(durationMs / 1000).toFixed(1)} s observed
    </p>}
    {transcript.length ? <ol className="flex flex-wrap gap-1.5" aria-label="Confirmed signs">
      {transcript.map(entry => <li key={entry.requestId} className="rounded-md bg-signal-light px-2.5 py-1 text-sm font-medium text-ink">
        {displayActivity(entry.label)}
      </li>)}
    </ol> : <p className="text-sm text-text-2">No accepted signs yet.</p>}
  </>
}

function LabDisclosure({ title, hint, children, defaultOpen }: {
  title: string; hint?: string; children: ReactNode; defaultOpen?: boolean
}) {
  return <details open={defaultOpen} className="group min-w-0 rounded-xl2 border border-border bg-white">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-xl2 px-3.5 py-3 text-sm hover:bg-sky sm:px-4 [&::-webkit-details-marker]:hidden">
      <span className="font-semibold text-ink">{title}</span>
      <span className="flex min-w-0 items-center gap-2 text-right text-xs text-text-2">
        {hint && <span>{hint}</span>}
        <ChevronDown aria-hidden="true" size={16} className="shrink-0 group-open:rotate-180" />
      </span>
    </summary>
    <div className="space-y-3 border-t border-border/60 p-3.5 sm:p-4">{children}</div>
  </details>
}

const CameraInferenceTiming = memo(function CameraInferenceTiming({ readTiming }: { readTiming: () => LiveCameraTiming | null }) {
  const [timing, setTiming] = useState<LiveCameraTiming | null>(null)
  useEffect(() => {
    const refresh = () => setTiming(readTiming())
    refresh()
    const timer = setInterval(refresh, 250)
    return () => clearInterval(timer)
  }, [readTiming])

  if (!timing) return <p className="text-sm text-text-2">Waiting for landmark timing…</p>

  return <div role="group" aria-label="Camera inference timing" className="space-y-3 text-sm">
      <dl className="grid grid-cols-2 gap-2 tabular-nums">
        <div className="rounded-lg bg-signal-light px-3 py-2.5">
          <dt className="text-xs font-medium text-trust">Processed FPS</dt>
          <dd className="text-xl font-semibold text-ink">{timing.processedFps?.toFixed(1) ?? '—'}</dd>
        </div>
        <div className="rounded-lg bg-sky px-3 py-2.5">
          <dt className="text-xs font-medium text-text-2">Presented FPS</dt>
          <dd className="text-xl font-semibold text-ink">{timing.presentedFps?.toFixed(1) ?? '—'}</dd>
        </div>
      </dl>
      <dl className="flex flex-wrap gap-x-4 gap-y-2 tabular-nums">
        {timing.handDelegate && <div><dt className="text-xs text-trust">
          Hands · {timing.handDelegate}{timing.latest.handCapacity && ` · ${timing.latest.handCapacity} max`}
        </dt>
          <dd>{formatMs(timing.latest.handMs)}</dd></div>}
        {timing.poseDelegate && <div><dt className="text-xs text-text-2">Pose · {timing.poseDelegate}</dt>
          <dd>{formatMs(timing.latest.poseMs)}</dd></div>}
        {timing.handDelegate && timing.poseDelegate && <div><dt className="text-xs text-text-2">Hands + pose</dt>
          <dd>{formatMs(timing.latest.handMs + timing.latest.poseMs)}</dd></div>}
      </dl>
      {timing.samples.length > 1 && (() => {
        const start = timing.samples[0].completedAt
        const span = Math.max(1, timing.latest.completedAt - start)
        const peak = Math.max(1, ...timing.samples.map(frame => Math.max(frame.handMs, frame.poseMs)))
        const points = (key: 'handMs' | 'poseMs') => timing.samples.map(frame =>
          `${300 * (frame.completedAt - start) / span},${42 - 40 * frame[key] / peak}`).join(' ')
        return <svg aria-hidden="true" viewBox="0 0 300 44" preserveAspectRatio="none" className="block h-10 w-full rounded-md bg-sky">
          {timing.handDelegate && <polyline points={points('handMs')} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" className="text-signal" />}
          {timing.poseDelegate && <polyline points={points('poseMs')} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" className="text-text-2" />}
        </svg>
      })()}
      <p className="text-xs leading-relaxed text-text-2 tabular-nums">
        {timing.inputWidth && timing.inputHeight ? `${timing.inputWidth} × ${timing.inputHeight}` : 'Camera input'}
        {' · '}Preparation {formatMs(timing.latest.resizeMs)} · Overlay {formatMs(timing.latest.overlayMs)} · Total {formatMs(timing.latest.totalMs)}
      </p>
  </div>
})

const RecognitionActivity = memo(function RecognitionActivity({ snapshot, latest, running, live, status, lastResultAt, lastFrameAt }: {
  snapshot: Session['state'] | null
  latest: Session['state']['rows'][number] | undefined
  running: boolean
  live: boolean
  status: string
  lastResultAt: RefObject<number>
  lastFrameAt: RefObject<number>
}) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live || !running) return
    const tick = () => setNow(Date.now())
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [live, running])

  const stale = running && live && now - (lastResultAt.current || -Infinity) > CONTINUOUS_SETTINGS.maxResultAgeMs
  const framesPaused = running && live && now - (lastFrameAt.current || -Infinity) > CONTINUOUS_SETTINGS.frameFreshnessMs
  const tracking = snapshot?.tracking
  const awaitingRecoveredWindow = tracking?.state === 'visible' && latest
    && (latest.tracking?.revision !== tracking.revision || latest.reason === 'tracking_changed_during_inference')
  const activity = framesPaused ? 'TRACKING PAUSED — no fresh camera observations'
    : tracking?.state === 'pose-lost' ? 'TRACKING LOST — keep both shoulders visible'
    : tracking?.state === 'frame-gap' ? 'TRACKING INTERRUPTED — rebuilding observations'
    : tracking?.state === 'no-hands' ? 'IDLE — no hands detected'
    : tracking?.state === 'hands-missing' ? 'TRACKING INTERRUPTED — hands briefly missing'
    : awaitingRecoveredWindow ? 'TRACKING RECOVERED — waiting for fresh recognition'
    : stale ? 'UNCERTAIN — awaiting fresh prediction'
    : snapshot?.segmentationPhase === 'observing' ? 'OBSERVING — no active gesture'
    : latest?.activity ?? 'Warming up'

  return <div className="rounded-lg bg-sky p-3">
    <h3 className="text-xs font-medium text-text-2">Latest activity</h3>
    <p className="mt-1 break-words text-base font-semibold text-ink" aria-live="polite" data-testid="recognition-activity">
      {snapshot ? activity : running ? status : 'Waiting for a run'}
    </p>
  </div>
})

const CAMERA_SNAPSHOT_INTERVAL_MS = 125

export default function RecognitionLabPage() {
  const [source, setSource] = useState<'video' | 'camera'>('video')
  const [modelMode, setModelMode] = useState<VisibleLabMode>(LIVE_SIGNS_MODEL)
  const [captionMode, setCaptionMode] = useState<LabCaptionMode>('v1')
  const [benchmarking, setBenchmarking] = useState(false)
  const [benchmarkReport, setBenchmarkReport] = useState<string | null>(null)
  const [landmarkMode, setLandmarkMode] = useState<LandmarkMode>('both')
  const [showPoseLandmarks, setShowPoseLandmarks] = useState(true)
  const [detectionInputWidth, setDetectionInputWidth] = useState<DetectionInputWidth>(null)
  const supportsMotionEvidence = modelMode === 'lab-signs43-shape-motion' || modelMode === LIVE_SIGNS_MODEL
    || modelMode === V2_MODEL || modelMode === EXPANDED_MODEL
  const [file, setFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('Choose a video to begin')
  const [error, setError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<Session['state'] | null>(null)
  const [pinnedBaseline, setPinnedBaseline] = useState<PinnedBaseline | null>(null)
  const [glossAnnotations, setGlossAnnotations] = useState<GlossAnnotation[]>([])
  const [glossEditorKey, setGlossEditorKey] = useState(0)
  const [fingerspelling, setFingerspelling] = useState(EMPTY_FINGERSPELLING)
  const [backend, setBackend] = useState<DiagnosticBackendInfo | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const videoOverlay = useRef<HTMLCanvasElement>(null)
  const videoFrames = useRef<DatasetFrame[]>([])
  const session = useRef<Session | null>(null)
  const predictor = useRef<Predictor | null>(null)
  const abort = useRef<AbortController | null>(null)
  const generation = useRef(0), lastResultAt = useRef(0)
  const snapshotTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultCount = useRef(0)
  const lastFrameAt = useRef(0)
  const replayInfo = useRef<unknown>(null)
  const mounted = useRef(true)
  const onCameraFrame = useCallback((sample: Parameters<Session['observe']>[0]) => {
    if (session.current?.active) { lastFrameAt.current = Date.now(); void session.current.observe(sample) }
  }, [])
  const feed = useCameraFeed({
    ...OPTIMIZED_LIVE_CAMERA_OPTIONS,
    onFrame: onCameraFrame, trackLiveTiming: true, landmarkMode, showPoseLandmarks, detectionInputWidth,
    trackOverlayPaint: true, gatePreviewHands: source === 'camera' && !running,
  })
  const canRecognizeFromCamera = landmarkMode === 'both' && feed.cameraReady && feed.poseDetected && !feed.modelError

  const clearSnapshotTimer = useCallback(() => {
    if (snapshotTimer.current !== null) clearTimeout(snapshotTimer.current)
    snapshotTimer.current = null
  }, [])
  const stop = useCallback(() => {
    abort.current?.abort(); session.current?.stop(); generation.current++
    clearSnapshotTimer()
    feed.stopPerformanceProfile()
    predictor.current?.close(); predictor.current = null
    if (mounted.current) { setRunning(false); setStatus('Stopped') }
  }, [clearSnapshotTimer, feed.stopPerformanceProfile])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stop() }
  }, [stop])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  const paintVideoOverlay = useCallback((sample?: LandmarkFrameSample) => {
    const canvas = videoOverlay.current, element = video.current
    if (!canvas || !element?.videoWidth || !element.videoHeight) return
    if (canvas.width !== element.videoWidth) canvas.width = element.videoWidth
    if (canvas.height !== element.videoHeight) canvas.height = element.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    if (sample) drawVideoLandmarks(context, { ...sample, leftHand: sample.rightHand, rightHand: sample.leftHand }, canvas.width, canvas.height)
  }, [])
  useEffect(() => {
    const element = video.current
    if (!element || running) return
    const paintAt = (seconds: number) => paintVideoOverlay(element.seeking ? undefined
      : previewFrame(videoFrames.current, seconds, 0, element.duration)?.raw)
    const refresh = () => paintAt(element.currentTime)
    const hasFrameCallback = typeof element.requestVideoFrameCallback === 'function'
    let frameRequest: number | undefined
    const present: VideoFrameRequestCallback = (_, metadata) => {
      paintAt(metadata.mediaTime)
      frameRequest = element.requestVideoFrameCallback(present)
    }
    if (hasFrameCallback) frameRequest = element.requestVideoFrameCallback(present)
    const events = ['loadeddata', 'seeking', 'seeked', ...(hasFrameCallback ? [] : ['timeupdate'])]
    events.forEach(event => element.addEventListener(event, refresh))
    refresh()
    return () => {
      if (frameRequest !== undefined) element.cancelVideoFrameCallback(frameRequest)
      events.forEach(event => element.removeEventListener(event, refresh))
    }
  }, [source, videoUrl, running, paintVideoOverlay])
  useEffect(() => {
    if (source === 'camera' && running && (!feed.enabled || feed.error || feed.modelError)) stop()
  }, [source, running, feed.enabled, feed.error, feed.modelError, stop])
  async function start() {
    if (running || benchmarking || (source === 'video' ? !file || !loaded || !video.current : !canRecognizeFromCamera)) return
    const confirmation = getRecognitionConfirmation()
    const token = ++generation.current
    clearSnapshotTimer()
    const controller = new AbortController(); abort.current = controller
    videoFrames.current = []
    paintVideoOverlay()
    session.current = null; replayInfo.current = null; lastResultAt.current = 0; lastFrameAt.current = 0; resultCount.current = 0
    setFingerspelling(EMPTY_FINGERSPELLING)
    if (source === 'camera') setGlossAnnotations([])
    setGlossEditorKey(key => key + 1)
    setSnapshot(null); setBackend(null); setError(null); setRunning(true); setStatus('Loading model…')
    const client = createDiagnosticPredictor(modelMode); predictor.current = client
    let transcriptCount = 0
    let lastSnapshotAt = -Infinity
    const publishSnapshot = () => {
      if (!mounted.current || token !== generation.current || !session.current) return
      clearSnapshotTimer()
      lastSnapshotAt = performance.now()
      setSnapshot({ ...session.current.state })
    }
    try {
      const verifiedBackend = await client.connect()
      if (token !== generation.current) return
      setBackend(verifiedBackend)
      const current = createDiagnosticSession({ source, ...LIVE_RECOGNITION_POLICY, ...confirmation, modelMode, name: source === 'video' ? file!.name : 'Continuous camera',
        wallClockWindows: source === 'camera',
        staticMotionCheck: supportsMotionEvidence,
        predict: request => client.predict(request),
        onWordBoundary: modelMode === 'lab-alphabet' ? () => {
          if (!mounted.current || token !== generation.current) return
          setFingerspelling(current => {
            if (!current.draft && !current.recognized) return current
            return {
              draft: '', recognized: '',
              words: current.draft
                ? [...current.words, { recognized: current.recognized, confirmed: current.draft }]
                : current.words,
            }
          })
        } : undefined,
        onChange: () => {
          if (!mounted.current || token !== generation.current) return
          const state = session.current?.state
          if (!state) return
          const ended = Boolean(state.failure) || !session.current?.active
          const wait = CAMERA_SNAPSHOT_INTERVAL_MS - (performance.now() - lastSnapshotAt)
          if (source === 'video' || ended || wait <= 0) publishSnapshot()
          else snapshotTimer.current ??= setTimeout(publishSnapshot, wait)
          if (modelMode === 'lab-alphabet' && state.transcript.length > transcriptCount) {
            const letters = state.transcript.slice(transcriptCount)
              .map(entry => entry.label).filter(label => /^[A-Z]$/.test(label)).join('')
            transcriptCount = state.transcript.length
            if (letters) setFingerspelling(current => ({ ...current,
              draft: current.draft + letters, recognized: current.recognized + letters }))
          }
          if (state.rows.length > resultCount.current) {
            resultCount.current = state.rows.length; lastResultAt.current = Date.now()
          }
          if (ended) {
            feed.stopPerformanceProfile()
            setRunning(false); setStatus(state.status); client.close()
            if (state.failure) setError(state.failure)
          }
        },
      })
      session.current = current
      if (source === 'video') {
        replayInfo.current = await replayVideo(video.current!, { signal: controller.signal,
          onFrame: async sample => {
            if (token !== generation.current) return
            videoFrames.current.push({ timestamp: sample.timestamp, raw: sample })
            paintVideoOverlay(sample)
            await current.observe(sample)
            if (!current.active) throw Error(current.state.failure ?? 'Replay stopped')
          },
          onProgress: (seconds, stage) => {
            if (mounted.current && token === generation.current) setStatus(`${stage} · ${seconds.toFixed(1)} s`)
          },
        })
        if (token !== generation.current) return
        await current.finish()
        if (token !== generation.current) return
        setStatus('Replay complete')
        setRunning(false); client.close()
      } else {
        feed.startPerformanceProfile()
        setStatus('Recognizing…')
      }
    } catch (err) {
      if (token !== generation.current || !mounted.current) return
      const message = err instanceof Error ? err.message : String(err)
      currentStop(message)
    }
    function currentStop(message: string) {
      controller.abort(); session.current?.stop('Failed'); client.close()
      setError(message); setRunning(false); setStatus('Recognition failed')
    }
  }

  const rows = snapshot?.rows ?? [], latest = rows[rows.length - 1]
  let lastPrediction = rows.length - 1
  while (lastPrediction >= 0 && !rows[lastPrediction].prediction) lastPrediction--
  const signTiming = rows[lastPrediction]
  const transcript = snapshot?.transcript ?? []
  const supportsGloss = modelMode === LIVE_SIGNS_MODEL || modelMode === V2_MODEL || modelMode === 'lab-alphabet'
  const glossSuggestions = modelMode === LIVE_SIGNS_MODEL || modelMode === V2_MODEL ? suggestLabGlosses(transcript, rows) : []
  const glossDurationMs = Math.floor(source === 'video' ? videoDurationMs : snapshot?.latestMs ?? 0)
  const blocked = running || feed.enabled
  function stopBenchmark() {
    setBenchmarkReport(feed.stopLandmarkBenchmark())
    setBenchmarking(false)
  }

  function exportReport() {
    const current = session.current
    if (!current) return
    download({ ...current.report(), replay: replayInfo.current,
      backend,
      ...(modelMode !== 'lab-alphabet' ? { captionMode } : {}),
      ...(supportsGloss ? { gloss: labGlossReport(source, glossDurationMs, glossSuggestions, glossAnnotations) } : {}),
      ...(pinnedBaseline ? { comparisonBaseline: {
        ...pinnedBaseline,
        gloss: source === 'video' && pinnedBaseline.modelMode === LIVE_SIGNS_MODEL
          ? { ...pinnedBaseline.gloss, annotations: glossAnnotations } : pinnedBaseline.gloss,
      } } : {}),
      ...(modelMode === 'lab-alphabet' ? { fingerspelling: { ...fingerspelling, pauseMs: FINGERSPELLING_PAUSE_MS } } : {}),
      cameraPerformance: source === 'camera' ? JSON.parse(feed.getPerformanceReport()) : null,
      inputFile: source === 'video' && file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null,
    }, `signsync-${source}-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  }

  function exportGlossTrack() {
    if (!file || !glossAnnotations.length) return
    download({
      format: 'signsync-gloss-track',
      inputFile: { name: file.name, size: file.size, lastModified: file.lastModified },
      gloss: labGlossReport('video', glossDurationMs, glossSuggestions, glossAnnotations),
    }, `signsync-gloss-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  }

  function readVideoPlayhead() {
    const element = video.current
    if (!element) return undefined
    element.pause()
    return element.currentTime * 1000
  }


  const cameraHelp = feed.error || feed.modelError ? 'Check the camera error above.'
    : benchmarking ? 'Stop the landmark benchmark to start recognition.'
    : !feed.enabled ? 'Turn on the camera to preview your signing space.'
    : !feed.cameraReady ? 'Starting the camera…'
    : landmarkMode !== 'both' ? 'Select Hands + pose to start recognition.'
    : !feed.poseDetected ? 'Keep both shoulders visible to start recognition.'
    : 'Camera ready. Start recognition when you’re ready to sign.'
  const captureError = error || (source === 'camera' && !feed.cameraReady ? feed.modelError : null)
  const runStatus = running || snapshot || error ? status : 'Ready'

  return <div className="mx-auto max-w-7xl">
    <PageHeader title="Recognition Lab" description="Test sign recognition with a video or live camera." />

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-4">
        <section aria-labelledby="lab-input" className="space-y-4 rounded-xl2 border border-border bg-white p-3.5 sm:p-5">
          <div className="grid items-end gap-3 md:grid-cols-[auto_minmax(0,1fr)]">
            <fieldset className="min-w-0" disabled={blocked}>
              <legend id="lab-input" className="mb-1.5 text-sm font-semibold text-ink">Input source</legend>
              <div className="inline-flex max-w-full rounded-lg bg-sky p-1">
                {([{ value: 'video', label: 'Video', Icon: Film }, { value: 'camera', label: 'Camera', Icon: Video }] as const)
                  .map(({ value, label, Icon }) => <label key={value} className="min-w-0">
                    <input className="peer sr-only" type="radio" name="lab-input-source" value={value} checked={source === value}
                      onChange={() => {
                        setSource(value)
                        setPinnedBaseline(null)
                        setFingerspelling(EMPTY_FINGERSPELLING)
                        setGlossAnnotations([])
                        setGlossEditorKey(key => key + 1)
                        if (value === 'video') setLoaded(false)
                        session.current = null; setSnapshot(null); setBackend(null); setError(null)
                        setStatus('Ready')
                      }} />
                    <span className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-text-2 peer-checked:bg-white peer-checked:text-ink peer-checked:shadow-sm peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-signal peer-disabled:cursor-not-allowed">
                      <Icon aria-hidden="true" size={15} className="shrink-0" /> {label}
                    </span>
                  </label>)}
              </div>
            </fieldset>
            <label className="block min-w-0 text-sm font-semibold text-ink">
              <span className="mb-1.5 block">Recognition model</span>
              <select value={modelMode} disabled={running} className={selectClass} onChange={event => {
                setModelMode(event.target.value as VisibleLabMode)
                setFingerspelling(EMPTY_FINGERSPELLING)
                if (source === 'camera') setGlossAnnotations([])
                setGlossEditorKey(key => key + 1)
                session.current = null; setSnapshot(null); setBackend(null); setError(null)
                setStatus('Ready')
              }}>
                {LAB_MODES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          {modelMode !== 'lab-alphabet' && <label className="block max-w-xs text-sm font-semibold text-ink">
            <span className="mb-1.5 block">Caption rules</span>
            <select value={captionMode} className={selectClass}
              onChange={event => setCaptionMode(event.target.value === 'v2' ? 'v2' : 'v1')}>
              <option value="v1">v1 demo</option>
              <option value="v2">v2 experiment</option>
            </select>
          </label>}

          {(modelMode === 'lab-signs33' || modelMode === 'lab-signs43-numbers') && <p className="text-sm text-text-2">
            Overlapping hands can obscure key landmarks. This pilot can mistake month signs and idle movement for supported signs.
          </p>}
          {modelMode === 'lab-alphabet' && <p className="text-sm text-text-2">
            Hold letters steady. Use the complete movement for J and Z.
          </p>}

          {source === 'video' ? (
            <div key="video-preview" className="relative aspect-video min-h-40 overflow-hidden rounded-lg bg-ink">
              <video ref={video} src={videoUrl || undefined} controls={!running} controlsList="nofullscreen" muted playsInline preload="auto"
                className={videoUrl ? 'absolute inset-0 h-full w-full object-contain' : 'hidden'}
                onLoadedData={event => {
                  setLoaded(true)
                  const duration = event.currentTarget.duration
                  setVideoDurationMs(Number.isFinite(duration) ? Math.floor(duration * 1000) : 0)
                }}
                onError={() => { setLoaded(false); setVideoDurationMs(0); setError('This browser could not open the video.') }} />
              {videoUrl && <canvas key={videoUrl} ref={videoOverlay} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
              {!videoUrl && <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 px-4 text-center text-white">
                <Film aria-hidden="true" size={26} className="text-white/70" />
                <p className="font-semibold">Choose a video to replay</p>
                <p className="text-sm text-white/70">Up to {MAX_REPLAY_SECONDS} seconds</p>
              </div>}
            </div>
          ) : (
            <CameraPanel showHandsWarning={landmarkMode !== 'pose'} feed={{ ...feed, toggleCamera: () => {
              if (running) stop()
              if (benchmarking) stopBenchmark()
              feed.toggleCamera()
            } }} />
          )}

          {captureError && <p role="alert" className="break-words rounded-lg bg-danger-light px-3 py-2 text-sm text-[#a3372f]">{captureError}</p>}

          <div className="flex flex-wrap items-center gap-2">
            {source === 'video' && (
              <div className="min-w-0">
                <input id="lab-video-file" className="peer sr-only" type="file" accept="video/*" disabled={running}
                  onChange={event => {
                    const next = event.target.files?.[0] ?? null
                    videoFrames.current = []
                    setPinnedBaseline(null)
                    setFingerspelling(EMPTY_FINGERSPELLING)
                    setGlossAnnotations([])
                    setGlossEditorKey(key => key + 1)
                    setVideoDurationMs(0)
                    setFile(next); setLoaded(false); setError(null); setSnapshot(null); setBackend(null); session.current = null
                    setVideoUrl(next ? URL.createObjectURL(next) : '')
                    setStatus(next ? 'Video ready' : 'Choose a video')
                  }} />
                <label htmlFor="lab-video-file" className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-signal peer-disabled:cursor-not-allowed peer-disabled:opacity-50 ${file ? 'border-border bg-white text-ink hover:bg-sky' : 'border-trust bg-trust text-white hover:bg-ink'}`}>
                  <Upload aria-hidden="true" size={16} /> {file ? 'Replace video' : 'Choose video'}
                </label>
              </div>
            )}
            <Button className={actionClass} size="sm" variant={running ? 'danger-solid' : 'primary'} onClick={running ? stop : start}
              disabled={!running && (benchmarking || (source === 'video' ? !loaded || !file : !canRecognizeFromCamera))}>
              {running ? <Square aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={15} />}
              {source === 'video' ? (running ? 'Stop replay' : 'Start replay') : (running ? 'Stop recognition' : 'Start recognition')}
            </Button>
          </div>
          {source === 'camera' && <div className="flex flex-wrap gap-2">
            <Button variant={benchmarking ? 'danger' : 'default'} size="sm" className={actionClass}
              disabled={!benchmarking && (running || !feed.cameraReady || !!feed.modelError)}
              onClick={() => {
                if (benchmarking) stopBenchmark()
                else {
                  feed.startLandmarkBenchmark()
                  setBenchmarking(true)
                }
              }}>
              {benchmarking ? 'Stop landmark benchmark' : 'Start landmark benchmark'}
            </Button>
            <Button variant="default" size="sm" className={actionClass} disabled={!benchmarkReport || benchmarking} onClick={() => {
              if (benchmarkReport) download(JSON.parse(benchmarkReport),
                `signsync-landmark-benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
            }}><Download aria-hidden="true" size={15} /> Export landmark benchmark</Button>
          </div>}
          {source === 'camera' ? (
            <div className="space-y-2 text-sm text-text-2">
              {feed.cameraReady && <div className="flex flex-wrap gap-2 text-xs font-medium">
                {landmarkMode !== 'pose' && <span className={`rounded-full px-2.5 py-1 ${feed.handsDetected ? 'bg-success-light text-success-dark' : 'bg-sky'}`}>
                  {feed.handsDetected ? 'Hands detected' : 'Waiting for hands'}
                </span>}
                {landmarkMode !== 'hands' && <span className={`rounded-full px-2.5 py-1 ${feed.poseDetected ? 'bg-success-light text-success-dark' : 'bg-sky'}`}>
                  {feed.poseDetected ? 'Pose detected' : 'Waiting for pose'}
                </span>}
              </div>}
              {!running && <p>{cameraHelp}</p>}
            </div>
          ) : file && <p className="break-words text-sm text-text-2">
            {file.name}{!loaded && !error && ' · Loading preview…'}
          </p>}
        </section>

        {source === 'camera' && <LabDisclosure title="Landmark performance" hint={benchmarking ? 'Benchmark recording' : undefined}>
          {feed.enabled && <CameraInferenceTiming readTiming={feed.getLiveTiming} />}
          <p className="text-xs leading-relaxed text-text-2">
            {benchmarking ? 'Keep this tab in the foreground while the benchmark runs.'
              : benchmarkReport ? 'Benchmark report ready to export.'
              : feed.enabled ? 'Wait for timing to appear, then run a benchmark with recognition stopped.'
              : 'Turn on the camera to see live timing and benchmark landmark updates.'}
          </p>
        </LabDisclosure>}

        {source === 'camera' && <LabDisclosure title="Landmark settings"
          hint={{ both: 'Hands + pose', hands: 'Hands only', pose: 'Pose only' }[landmarkMode]}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block min-w-0 space-y-1 text-sm font-medium">
              <span>Landmark mode</span>
              <select value={landmarkMode} disabled={running || benchmarking} className={selectClass}
                onChange={event => setLandmarkMode(event.target.value as LandmarkMode)}>
                <option value="both">Hands + pose</option>
                <option value="hands">Hands only</option>
                <option value="pose">Pose only</option>
              </select>
            </label>
            <label className="block min-w-0 space-y-1 text-sm font-medium">
              <span>Landmark input</span>
              <select value={detectionInputWidth ?? 'original'} disabled={running || benchmarking} className={selectClass}
                onChange={event => setDetectionInputWidth(event.target.value === '640' ? 640 : null)}>
                <option value="original">Original camera resolution</option>
                <option value={640}>640 px maximum width</option>
              </select>
            </label>
          </div>
          {landmarkMode !== 'hands' && <label className="inline-flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-signal" checked={showPoseLandmarks}
              disabled={benchmarking} onChange={event => setShowPoseLandmarks(event.target.checked)} />
            Show pose landmarks
          </label>}
        </LabDisclosure>}

      </div>

      <div className="min-w-0 space-y-4">
        <section aria-labelledby="lab-recognition" className="space-y-4 rounded-xl2 border border-border bg-white p-3.5 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="lab-recognition" className="font-display text-lg font-bold text-ink">Recognition results</h2>
            <span role="status" className={`rounded-full px-2.5 py-1 text-xs font-medium ${running ? 'bg-signal-light text-trust' : 'bg-sky text-text-2'}`}>
              {runStatus}
            </span>
          </div>
          <RecognitionActivity snapshot={snapshot} latest={latest} running={running} live={source === 'camera'}
            status={status} lastResultAt={lastResultAt} lastFrameAt={lastFrameAt} />
          {modelMode === 'lab-alphabet' && <div className="space-y-3 rounded-lg border border-border p-3">
            <label className="block space-y-1 text-sm font-semibold text-ink">
              <span>Fingerspelling draft</span>
              <input type="text" value={fingerspelling.draft} placeholder="Spell a word"
                className="min-h-10 w-full rounded-lg border border-border px-2.5 text-base"
                autoComplete="off" spellCheck={false}
                onChange={event => {
                  const draft = event.currentTarget.value.replace(/[^a-z]/gi, '').toUpperCase()
                  setFingerspelling(current => ({ ...current, draft }))
                }} />
            </label>
            <p className="text-xs text-text-2">Lower your hands for {FINGERSPELLING_PAUSE_MS / 1000} seconds to finish the word.</p>
            <Button type="button" size="sm" disabled={!fingerspelling.draft && !fingerspelling.recognized}
              onClick={() => setFingerspelling(current => ({ ...current, draft: '', recognized: '' }))}>Clear word</Button>
            {fingerspelling.words.length > 0 && <div className="space-y-2">
              <h3 className="text-sm font-semibold text-ink">Completed words</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {fingerspelling.words.map((word, index) => <input key={index} type="text"
                  aria-label={`Completed word ${index + 1}`} value={word.confirmed}
                  className="min-h-10 w-full rounded-lg border border-border px-2.5 text-sm"
                  autoComplete="off" spellCheck={false}
                  onChange={event => {
                    const confirmed = event.currentTarget.value.replace(/[^a-z]/gi, '').toUpperCase()
                    setFingerspelling(current => ({ ...current,
                      words: current.words.map((entry, position) => position === index ? { ...entry, confirmed } : entry),
                    }))
                  }} />)}
              </div>
            </div>}
          </div>}
          <div className={`grid gap-3 ${pinnedBaseline ? 'sm:grid-cols-2' : ''}`}>
            {pinnedBaseline && <section aria-label="Pinned baseline" className="min-w-0 rounded-lg border border-border p-3">
              <h3 className="mb-2 text-sm font-semibold text-ink">
                {LAB_MODES.find(option => option.value === pinnedBaseline.modelMode)?.label} · Pinned
              </h3>
              <ConfirmedSigns transcript={pinnedBaseline.transcript} durationMs={pinnedBaseline.durationMs} />
              <LabCaptionPreview transcript={pinnedBaseline.transcript} mode={pinnedBaseline.captionMode} />
              <LabGlossSuggestions suggestions={pinnedBaseline.gloss.suggestions} />
            </section>}
            {(pinnedBaseline || modelMode !== 'lab-alphabet' || fingerspelling.words.length === 0) &&
              <section aria-label="Current run" className={pinnedBaseline ? 'min-w-0 rounded-lg border border-border p-3' : 'min-w-0'}>
                <h3 className="mb-2 text-sm font-semibold text-ink">
                  {pinnedBaseline ? LAB_MODES.find(option => option.value === modelMode)?.label : 'Confirmed signs'}
                </h3>
                <div data-testid="lab-transcript">
                  <ConfirmedSigns transcript={transcript} durationMs={pinnedBaseline ? snapshot?.latestMs : undefined} />
                </div>
                {modelMode !== 'lab-alphabet' && <LabCaptionPreview transcript={transcript} mode={captionMode} />}
              </section>}
          </div>
          {supportsGloss && (source === 'video' ? loaded : snapshot) && <LabGlossTrack key={glossEditorKey}
            suggestions={glossSuggestions} annotations={glossAnnotations} onChange={setGlossAnnotations}
            running={running} durationMs={glossDurationMs} modelMode={modelMode}
            readPlayhead={source === 'video' ? readVideoPlayhead : undefined} />}
          <div className="flex flex-wrap gap-2">
            {(modelMode === LIVE_SIGNS_MODEL || modelMode === STANDALONE_MODEL) && <Button type="button" size="sm" className={actionClass}
              disabled={running || !snapshot?.frames || Boolean(error) || !backend}
              onClick={() => {
                if (running || !snapshot?.frames || error || !backend || !session.current) return
                const { settings, minimumConfidence } = session.current.report()
                setPinnedBaseline({ modelMode, recognizerId: backend.recognizerId, source,
                  durationMs: snapshot.latestMs, settings, minimumConfidence, transcript: [...transcript], captionMode,
                  gloss: labGlossReport(source, glossDurationMs, glossSuggestions, glossAnnotations) })
              }}>
              {pinnedBaseline ? 'Replace pinned baseline' : 'Pin baseline run'}
            </Button>}
            {pinnedBaseline && <Button type="button" size="sm" className={actionClass} onClick={() => setPinnedBaseline(null)}>
              Clear pinned baseline
            </Button>}
            <Button variant="default" size="sm" className={actionClass} disabled={!snapshot?.frames} onClick={exportReport}>
              <Download aria-hidden="true" size={15} /> Export recognition results
            </Button>
            {source === 'video' && supportsGloss && !snapshot?.frames && glossAnnotations.length > 0 &&
              <Button type="button" size="sm" className={actionClass} disabled={running} onClick={exportGlossTrack}>
                <Download aria-hidden="true" size={15} /> Export gloss annotations
              </Button>}
          </div>
        </section>

        <LabDisclosure title="Diagnostic log" defaultOpen hint={`${rows.length} ${rows.length === 1 ? 'window' : 'windows'}`}>
          {backend && <p className="break-all text-xs text-text-2" data-testid="verified-backend">
            {backend.recognizerId} · {backend.endpoint}
          </p>}
          {snapshot ? <>
            {signTiming?.prediction && <p className="text-sm text-ink">
              Latest prediction · {displayActivity(signTiming.prediction.label)} · {(signTiming.prediction.score * 100).toFixed(1)}%
            </p>}
            <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
              <div><dt className="text-xs text-text-2">Sign inference</dt><dd>{formatMs(signTiming?.prediction?.inferenceMs)}</dd></div>
              <div><dt className="text-xs text-text-2">Request round trip</dt><dd>{formatMs(signTiming?.roundTripMs)}</dd></div>
            </dl>
            <p className="text-xs text-text-2">{snapshot.frames} frames · {snapshot.staleResults} stale results blocked</p>
          </> : <p className="text-sm text-text-2">Start a run to see prediction windows and request timing.</p>}
          {latest?.prediction?.inputKind && <p className="text-xs text-text-2">
            Model input · {{ static: 'steady hold', temporal: 'motion sequence', joint: 'handshape + motion', unusable: 'waiting for tracking' }[latest.prediction.inputKind]}
            {latest.prediction.inputReason && ' · ' + latest.prediction.inputReason.replace(/_/g, ' ')}
            {latest.prediction.motion !== undefined && ' · movement ' + latest.prediction.motion.toFixed(3)}
          </p>}
          {latest?.prediction?.staticCandidate && <p className="text-xs text-text-2">
            Handshape · {latest.prediction.staticCandidate.label} {(latest.prediction.staticCandidate.score * 100).toFixed(1)}%
            {' · required ' + ((latest.prediction.confidenceThreshold ?? .8) * 100).toFixed(0) + '%'}
          </p>}
          {latest?.numberHold && <p className="text-sm" data-testid="number-hold-evidence">
            {latest.numberHold.reason.replace(/_/g, ' ')} · {latest.numberHold.observedMs.toFixed(0)} ms
            {latest.numberHold.displacement !== null && ' · movement ' + latest.numberHold.displacement.toFixed(3)}
          </p>}
          {rows.length > 0 && <div tabIndex={0} role="region" aria-label="Recent prediction windows" className="max-h-72 overflow-auto rounded-lg border border-border/60">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-sky text-text-2">
                <tr><th scope="col" className="p-2">Time</th><th scope="col" className="p-2">Prediction</th><th scope="col" className="p-2">Decision</th></tr>
              </thead>
              <tbody>{rows.slice(-40).reverse().map((row, index) => <tr key={row.endMs + '-' + index} className="border-t border-border/60 align-top">
                <td className="whitespace-nowrap p-2 tabular-nums">{((row.decisionMs ?? row.endMs) / 1000).toFixed(2)} s</td>
                <td className="p-2">{row.prediction ? displayActivity(row.prediction.label) + ' ' + (row.prediction.score * 100).toFixed(1) + '%' : '—'}</td>
                <td className="p-2">{row.reason.replace(/_/g, ' ')}
                  {row.numberHold && <span className="block text-text-2">
                    {row.numberHold.observedMs.toFixed(0)} ms · movement {row.numberHold.displacement?.toFixed(3) ?? '—'}
                  </span>}
                </td>
              </tr>)}</tbody>
            </table>
          </div>}
        </LabDisclosure>
      </div>
    </div>
  </div>
}
