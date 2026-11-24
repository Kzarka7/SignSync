import { memo, useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ChevronDown, Download, Film, Play, Square, Trash2, Upload, Video, X } from 'lucide-react'
import { collectorShortcut } from '../services/dataset/collectorShortcuts'
import { queueSignSummary } from '../services/landmarks/queueReview'
import PageHeader from '../components/layout/PageHeader'
import CameraPanel from '../components/live/CameraPanel'
import LabCaptionPreview from '../components/live/LabCaptionPreview'
import LabGlossTrack, { LabGlossSuggestions } from '../components/live/LabGlossTrack'
import { DEFAULT_LIVE_CAPTURE_PROFILE, OPTIMIZED_LIVE_CAMERA_OPTIONS, useCameraFeed, type CaptureProfile, type LandmarkMode, type LiveCameraTiming } from '../hooks/useCameraFeed'
import type { HandDelegatePreference } from '../services/landmarks/visionRuntime'

// Lab only: the palm detector also accepts curled-finger shapes and blurred
// hands. Other pages keep the 0.5 default.
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
const COMBINED_MODEL = 'lab-signs74-combined'
// Recipe E candidate: same 43 signs as v1 (sign-motion-cues-v1 features, bidirectional GRU).
const MOTION_E_MODEL = 'lab-signs43-motion-e'
const LAB_MODES = [
  { value: LIVE_SIGNS_MODEL, label: BASELINE_LABEL },
  { value: MOTION_E_MODEL, label: '43 Similar Signs (motion E candidate)' },
  // Archived 2026-11-24 (see SignSync Dataset/documentation/candidates-archive-20261124.md):
  // 43 v2, 75 multi-batch, 32 similarity, IX/POSS first pilot, 33 signs, 43 numbers, 43 shape-motion.
  { value: STANDALONE_MODEL, label: '32 Signs (standalone v3)' },
  { value: 'lab-signs32-standalone-v4', label: '32 Signs (standalone v4, 60 clips per sign)' },
  { value: 'lab-signs32-standalone-v5', label: '32 Signs (standalone v5, adds P4 clips)' },
  { value: 'lab-signs32-standalone-v5-motion', label: '32 Signs (standalone v5, motion + augmentation)' },
  { value: COMBINED_MODEL, label: '74 Signs + PARENTS (combined v3)' },
  { value: 'lab-ix-poss-motion', label: 'Indexing + Possessives (motion v1)' },
  { value: 'p4-candidate', label: 'P4 experimental' },
  { value: 'lab-alphabet', label: 'Alphabet A–Z' },
] as const satisfies readonly { value: LabRecognitionMode | 'p4-candidate'; label: string }[]
// Wider than LAB_MODES so the branches for archived models still typecheck if they are restored.
type VisibleLabMode = LabRecognitionMode | 'p4-candidate'
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
type QueuedVideo = { id: number; file: File }
type VideoResult = {
  status: 'Complete' | 'Stopped' | 'Failed'
  session: Session | null
  frames: DatasetFrame[]
  backend: DiagnosticBackendInfo | null
  replay: Awaited<ReturnType<typeof replayVideo>> | null
  fingerspelling: FingerspellingTrial
  error?: string
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
        {timing.lowLightGain > 1 && ` · Low-light lift ×${timing.lowLightGain.toFixed(2)}`}
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
  // 640 px keeps the frame's aspect ratio and normalized landmark
  // coordinates, so recognition features are unchanged; the hand model is
  // about 4 ms faster per frame on integrated graphics.
  const [detectionInputWidth, setDetectionInputWidth] = useState<DetectionInputWidth>(640)
  const [lowLightAssist, setLowLightAssist] = useState(true)
  const [handDelegate, setHandDelegate] = useState<HandDelegatePreference>('GPU')
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile>(DEFAULT_LIVE_CAPTURE_PROFILE)
  const [deferPose, setDeferPose] = useState(true)
  // Lab trial before the Collector: one-hand model while a single hand is tracked.
  const [adaptiveHandCapacity, setAdaptiveHandCapacity] = useState(true)
  const supportsMotionEvidence = modelMode === 'lab-signs43-shape-motion' || modelMode === LIVE_SIGNS_MODEL
    || modelMode === V2_MODEL || modelMode === EXPANDED_MODEL || modelMode === COMBINED_MODEL
  const [videoQueue, setVideoQueue] = useState<QueuedVideo[]>([])
  const [videoId, setVideoId] = useState<number | null>(null)
  const file = videoQueue.find(item => item.id === videoId)?.file ?? null
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
  const replayInfo = useRef<VideoResult['replay']>(null)
  const nextVideoId = useRef(0)
  const selectedQueueRow = useRef<HTMLLIElement>(null)
  const videoResults = useRef(new Map<string, VideoResult>())
  const videoReview = useRef(new Map<number, { annotations: GlossAnnotation[]; baseline: PinnedBaseline | null }>())
  const saveStoppedVideo = useRef<(() => void) | null>(null)
  const mounted = useRef(true)
  const onCameraFrame = useCallback((sample: Parameters<Session['observe']>[0]) => {
    if (session.current?.active) { lastFrameAt.current = Date.now(); void session.current.observe(sample) }
  }, [])
  const feed = useCameraFeed({
    ...OPTIMIZED_LIVE_CAMERA_OPTIONS,
    onFrame: onCameraFrame, trackLiveTiming: true, landmarkMode, showPoseLandmarks, detectionInputWidth, lowLightAssist,
    handDelegate, captureProfile, deferPose, adaptiveHandCapacity,
    trackOverlayPaint: true,
  })
  const canRecognizeFromCamera = landmarkMode === 'both' && feed.cameraReady && feed.poseDetected && !feed.modelError

  const clearSnapshotTimer = useCallback(() => {
    if (snapshotTimer.current !== null) clearTimeout(snapshotTimer.current)
    snapshotTimer.current = null
  }, [])
  const stop = useCallback(() => {
    const controller = abort.current
    session.current?.stop()
    controller?.abort()
    abort.current = null
    if (mounted.current) saveStoppedVideo.current?.()
    saveStoppedVideo.current = null
    generation.current++
    clearSnapshotTimer()
    feed.stopPerformanceProfile()
    predictor.current?.close(); predictor.current = null
    if (mounted.current) { setRunning(false); setStatus('Stopped') }
  }, [clearSnapshotTimer, feed.stopPerformanceProfile])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stop() }
  }, [stop])
  useEffect(() => {
    if (source !== 'video' || running) return
    setLoaded(false); setVideoDurationMs(0)
    const element = video.current
    if (!file || !element) return
    const url = URL.createObjectURL(file)
    element.src = url
    return () => {
      if (element.getAttribute('src') === url) {
        element.pause()
        element.removeAttribute('src')
        element.load()
      }
      URL.revokeObjectURL(url)
    }
  }, [file, source, running])
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
  }, [source, file, running, paintVideoOverlay])
  useEffect(() => {
    if (source === 'camera' && running && (!feed.enabled || feed.error || feed.modelError)) stop()
  }, [source, running, feed.enabled, feed.error, feed.modelError, stop])
  function videoResultKey(id: number, mode = modelMode) { return mode + ':' + id }

  function saveVideoReview() {
    if (source === 'video' && videoId !== null) {
      videoReview.current.set(videoId, { annotations: glossAnnotations, baseline: pinnedBaseline })
    }
  }

  function showVideo(item: QueuedVideo | null, mode = modelMode) {
    setVideoId(item?.id ?? null)
    const result = item ? videoResults.current.get(videoResultKey(item.id, mode)) : undefined
    const review = item ? videoReview.current.get(item.id) : undefined
    session.current = result?.session ?? null
    videoFrames.current = result?.frames ?? []
    replayInfo.current = result?.replay ?? null
    setSnapshot(result?.session ? { ...result.session.state } : null)
    setBackend(result?.backend ?? null)
    setFingerspelling(result?.fingerspelling ?? EMPTY_FINGERSPELLING)
    setGlossAnnotations(review?.annotations ?? [])
    setPinnedBaseline(review?.baseline ?? null)
    setGlossEditorKey(key => key + 1)
    setError(result?.error ?? null)
    setStatus(result?.status ?? (item ? 'Ready to replay' : 'Choose videos to begin'))
  }

  useEffect(() => {
    if (source !== 'video' || running || !videoQueue.length || typeof window === 'undefined') return
    const navigate = (event: KeyboardEvent) => {
      const action = collectorShortcut(event)
      if (action !== 'previous' && action !== 'next') return
      event.preventDefault()
      const index = videoQueue.findIndex(item => item.id === videoId)
      const next = Math.max(0, Math.min(videoQueue.length - 1, index < 0 ? 0 : index + (action === 'next' ? 1 : -1)))
      if (videoQueue[next].id === videoId) return
      saveVideoReview(); showVideo(videoQueue[next])
    }
    window.addEventListener('keydown', navigate)
    return () => window.removeEventListener('keydown', navigate)
  }, [source, running, videoQueue, videoId, modelMode, glossAnnotations, pinnedBaseline])

  useEffect(() => {
    if (source === 'video') selectedQueueRow.current?.scrollIntoView({ block: 'nearest' })
  }, [source, videoId])

  const queueStarted = videoQueue.some(item => videoResults.current.has(videoResultKey(item.id)))
  const queueFinished = videoQueue.length > 0 && videoQueue.every(item =>
    ['Complete', 'Failed'].includes(videoResults.current.get(videoResultKey(item.id))?.status ?? ''))

  async function start(scope: 'queue' | 'single' | 'continue' = 'queue') {
    const replayQueue = scope === 'single' ? videoQueue.filter(item => item.id === videoId)
      : scope === 'continue' ? videoQueue.filter(item => videoResults.current.get(videoResultKey(item.id))?.status !== 'Complete') : videoQueue
    if (abort.current && !abort.current.signal.aborted || running || benchmarking ||
      (source === 'video' ? !replayQueue.length : !canRecognizeFromCamera)) return
    const confirmation = getRecognitionConfirmation()
    const token = ++generation.current
    const controller = new AbortController()
    abort.current = controller
    const isCurrent = () => mounted.current && token === generation.current && !controller.signal.aborted
    clearSnapshotTimer()
    setRunning(true); setError(null); setStatus('Loading model…')
    if (source === 'video') saveVideoReview()
    else {
      session.current = null; replayInfo.current = null
      setBackend(null); setSnapshot(null); setGlossAnnotations([])
      setGlossEditorKey(key => key + 1)
      setFingerspelling(EMPTY_FINGERSPELLING)
    }

    function openSession(client: Predictor, name: string) {
      let transcriptCount = 0, lastSnapshotAt = -Infinity
      let spelling = EMPTY_FINGERSPELLING
      lastResultAt.current = 0; lastFrameAt.current = 0; resultCount.current = 0
      const publishSnapshot = () => {
        if (!isCurrent() || !session.current) return
        clearSnapshotTimer()
        lastSnapshotAt = performance.now()
        setSnapshot({ ...session.current.state })
      }
      const current = createDiagnosticSession({
        source, ...LIVE_RECOGNITION_POLICY, ...confirmation, modelMode, name,
        wallClockWindows: source === 'camera', poseGuidedOcclusion: source === 'camera',
        // Motion E: only the FIVE/WAVE_GREETING pair and the TEN -> next-sign rule (see signMotionEvidence.ts).
        staticMotionCheck: supportsMotionEvidence || modelMode === MOTION_E_MODEL,
        ...(modelMode === MOTION_E_MODEL ? { motionProfile: 'motion-e' as const } : {}),
        predict: request => client.predict(request),
        onWordBoundary: modelMode === 'lab-alphabet' ? () => {
          if (!isCurrent() || !spelling.draft && !spelling.recognized) return
          spelling = {
            draft: '', recognized: '',
            words: spelling.draft ? [...spelling.words, { recognized: spelling.recognized, confirmed: spelling.draft }] : spelling.words,
          }
          setFingerspelling(spelling)
        } : undefined,
        onChange: () => {
          if (!isCurrent()) return
          const state = session.current?.state
          if (!state) return
          const ended = Boolean(state.failure) || !session.current?.active
          const wait = CAMERA_SNAPSHOT_INTERVAL_MS - (performance.now() - lastSnapshotAt)
          if (ended || wait <= 0) publishSnapshot()
          else snapshotTimer.current ??= setTimeout(publishSnapshot, wait)
          if (modelMode === 'lab-alphabet' && state.transcript.length > transcriptCount) {
            const letters = state.transcript.slice(transcriptCount)
              .map(entry => entry.label).filter(label => /^[A-Z]$/.test(label)).join('')
            transcriptCount = state.transcript.length
            if (letters) {
              spelling = { ...spelling, draft: spelling.draft + letters, recognized: spelling.recognized + letters }
              setFingerspelling(spelling)
            }
          }
          if (state.rows.length > resultCount.current) {
            resultCount.current = state.rows.length; lastResultAt.current = Date.now()
          }
          if (ended && source === 'camera') {
            feed.stopPerformanceProfile()
            abort.current = null
            setRunning(false); setStatus(state.status); client.close()
            if (state.failure) setError(state.failure)
          }
        },
      })
      session.current = current
      return { current, getSpelling: () => spelling }
    }

    async function replayItem(item: QueuedVideo, position: number) {
      const client = createDiagnosticPredictor(modelMode)
      predictor.current = client
      let current: Session | null = null
      let verifiedBackend: DiagnosticBackendInfo | null = null
      let getSpelling = () => EMPTY_FINGERSPELLING
      const saveResult = (status: VideoResult['status'], error?: string) => {
        videoResults.current.set(videoResultKey(item.id), { status, error, session: current, frames: videoFrames.current,
          backend: verifiedBackend, replay: replayInfo.current, fingerspelling: getSpelling() })
        if (current) setSnapshot({ ...current.state })
      }
      saveStoppedVideo.current = () => saveResult('Stopped')
      const progress = videoQueue.length > 1 ? (position + 1) + ' of ' + videoQueue.length + ' · ' : ''
      try {
        setStatus(progress + 'Loading model…')
        verifiedBackend = await client.connect()
        if (!isCurrent()) return false
        setBackend(verifiedBackend)
        const run = openSession(client, item.file.name)
        current = run.current
        getSpelling = run.getSpelling
        const replay = await replayVideo(item.file, {
          video: video.current,
          signal: controller.signal,
          onFrame: async sample => {
            controller.signal.throwIfAborted()
            videoFrames.current.push({ timestamp: sample.timestamp, raw: sample })
            await run.current.observe(sample)
            if (!run.current.active || run.current.state.failure)
              throw Error(run.current.state.failure ?? 'Replay stopped')
          },
          onPreview: sample => {
            if (isCurrent()) paintVideoOverlay(sample)
          },
          onProgress: (seconds, stage) => {
            if (isCurrent()) setStatus(progress + stage + ' · ' + seconds.toFixed(1) + ' s')
          },
        })
        if (!isCurrent()) return false
        replayInfo.current = replay
        setVideoDurationMs(Math.floor(replay.durationSeconds * 1000))
        await current.finish()
        if (!isCurrent()) return false
        if (current.state.failure) throw Error(current.state.failure)
        saveResult('Complete')
        return true
      } catch (err) {
        if (!isCurrent()) return false
        const message = err instanceof Error ? err.message : String(err)
        current?.stop('Failed')
        saveResult('Failed', message)
        setError(message)
        if (!current || current.state.failure) throw err
        return false
      } finally {
        client.close()
        if (isCurrent()) {
          predictor.current = null
          saveStoppedVideo.current = null
        }
      }
    }

    try {
      if (source === 'camera') {
        const client = createDiagnosticPredictor(modelMode)
        predictor.current = client
        const verifiedBackend = await client.connect()
        if (!isCurrent()) return
        setBackend(verifiedBackend)
        openSession(client, 'Continuous camera')
        feed.startPerformanceProfile()
        setStatus('Recognizing…')
        return
      }
      video.current?.pause()
      for (const item of replayQueue) videoResults.current.delete(videoResultKey(item.id))
      let completed = 0
      for (const [position, item] of videoQueue.entries()) {
        if (!replayQueue.includes(item)) continue
        clearSnapshotTimer()
        showVideo(item)
        paintVideoOverlay()
        if (await replayItem(item, position)) completed++
        if (!isCurrent()) return
      }
      const failed = replayQueue.length - completed
      setStatus(replayQueue.length === 1 ? (failed ? 'Replay failed' : 'Replay complete')
        : completed + ' of ' + replayQueue.length + ' videos replayed' + (failed ? ' · ' + failed + ' failed' : ''))
      setRunning(false)
      abort.current = null
    } catch (err) {
      if (!isCurrent()) return
      controller.abort(); abort.current = null
      session.current?.stop('Failed'); predictor.current?.close(); predictor.current = null
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false); setStatus('Recognition failed')
    }
  }

  const rows = snapshot?.rows ?? [], latest = rows[rows.length - 1]
  let lastPrediction = rows.length - 1
  while (lastPrediction >= 0 && !rows[lastPrediction].prediction) lastPrediction--
  const signTiming = rows[lastPrediction]
  const transcript = snapshot?.transcript ?? []
  const supportsGloss = modelMode === LIVE_SIGNS_MODEL || modelMode === V2_MODEL || modelMode === MOTION_E_MODEL
    || modelMode === 'lab-alphabet'
  const glossSuggestions = modelMode === LIVE_SIGNS_MODEL || modelMode === V2_MODEL || modelMode === MOTION_E_MODEL
    ? suggestLabGlosses(transcript, rows) : []
  const glossDurationMs = Math.floor(source === 'video'
    ? replayInfo.current ? replayInfo.current.durationSeconds * 1000 : videoDurationMs
    : snapshot?.latestMs ?? 0)
  const blocked = running || feed.enabled
  function stopBenchmark() {
    setBenchmarkReport(feed.stopLandmarkBenchmark())
    setBenchmarking(false)
  }

  function exportQueueResults() {
    download({
      format: 'signsync-video-queue-results', schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      model: { id: modelMode, name: LAB_MODES.find(mode => mode.value === modelMode)?.label ?? modelMode },
      clipCount: videoQueue.length,
      votingMethod: 'Each prediction window contributes one top-label vote, including unconfirmed predictions. Ties use the first label seen. Confirmed transcripts take precedence.',
      clips: videoQueue.map((item, index) => {
        const result = videoResults.current.get(videoResultKey(item.id))
        const state = result?.session?.state
        return {
          position: index + 1, queueId: item.id,
          file: { name: item.file.name, sizeBytes: item.file.size, type: item.file.type || null, lastModified: item.file.lastModified },
          status: result?.status ?? 'Queued',
          ...queueSignSummary(state, displayActivity),
          confirmedSigns: state?.transcript ?? [],
          durationSeconds: result?.replay?.durationSeconds ?? null,
          observedDurationMs: state?.latestMs ?? null,
          settings: result?.session?.report().settings ?? null,
          backend: result?.backend ?? null,
          error: result?.error ?? null,
        }
      }),
    }, `signsync-queue-results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
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
                        saveVideoReview()
                        setSource(value)
                        if (value === 'video') {
                          setLoaded(false)
                          showVideo(videoQueue.find(item => item.id === videoId) ?? null)
                          return
                        }
                        setPinnedBaseline(null)
                        setFingerspelling(EMPTY_FINGERSPELLING)
                        setGlossAnnotations([])
                        setGlossEditorKey(key => key + 1)
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
                const mode = event.target.value as VisibleLabMode
                saveVideoReview()
                setModelMode(mode)
                if (source === 'video') {
                  showVideo(videoQueue.find(item => item.id === videoId) ?? null, mode)
                  return
                }
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
              <video ref={video} controls={!running} controlsList="nofullscreen" muted playsInline preload="auto"
                className={file ? 'absolute inset-0 h-full w-full object-contain' : 'hidden'}
                onLoadedData={event => {
                  setLoaded(true)
                  const duration = event.currentTarget.duration
                  setVideoDurationMs(Number.isFinite(duration) ? Math.floor(duration * 1000) : 0)
                }}
                onError={() => { setLoaded(false); setVideoDurationMs(0) }} />
              {file && <canvas ref={videoOverlay} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full object-contain" />}
              {!file && <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 px-4 text-center text-white">
                <Film aria-hidden="true" size={26} className="text-white/70" />
                <p className="font-semibold">Choose videos to replay</p>
                <p className="text-sm text-white/70">Up to {MAX_REPLAY_SECONDS} seconds per video</p>
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
                <input id="lab-video-file" className="peer sr-only" type="file" accept="video/*,.mp4,.webm,.mov,.mkv" multiple disabled={running}
                  onChange={event => {
                    const items = Array.from(event.target.files ?? [], file => ({ file, id: ++nextVideoId.current }))
                    event.target.value = ''
                    if (!items.length) return
                    saveVideoReview()
                    setVideoQueue(queue => [...queue, ...items])
                    showVideo(items[0])
                  }} />
                <label htmlFor="lab-video-file" className={`inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-signal peer-disabled:cursor-not-allowed peer-disabled:opacity-50 ${file ? 'border-border bg-white text-ink hover:bg-sky' : 'border-trust bg-trust text-white hover:bg-ink'}`}>
                  <Upload aria-hidden="true" size={16} /> {file ? 'Add videos' : 'Choose videos'}
                </label>
              </div>
            )}
            <Button className={actionClass} size="sm" variant={running ? 'danger-solid' : 'primary'}
              onClick={running ? stop : () => start(queueStarted && !queueFinished ? 'continue' : 'queue')}
              disabled={!running && (benchmarking || (source === 'video' ? !videoQueue.length : !canRecognizeFromCamera))}>
              {running ? <Square aria-hidden="true" size={14} /> : <Play aria-hidden="true" size={15} />}
              {source === 'video' ? (running ? 'Stop replay' : queueFinished ? 'Replay again' : queueStarted ? 'Continue replay' : 'Replay queue') : (running ? 'Stop recognition' : 'Start recognition')}
            </Button>
            {source === 'video' && <Button className={actionClass} size="sm"
              disabled={benchmarking || !file || running}
              onClick={() => start('single')}>
              <Play aria-hidden="true" size={15} /> Replay
            </Button>}
            {source === 'video' && <Button className={`${actionClass} ml-auto`} size="sm"
              disabled={running || !videoQueue.length} onClick={exportQueueResults}>
              <Download aria-hidden="true" size={15} /> Export results
            </Button>}
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
                {feed.lowLightAssistActive && <span className="rounded-full bg-sky px-2.5 py-1"
                  title="The hands are dark, so the landmark detectors receive a brightened copy of each frame. The preview is unchanged.">
                  Low-light assist on
                </span>}
              </div>}
              {!running && <p>{cameraHelp}</p>}
            </div>
          ) : videoQueue.length > 0 && <section aria-labelledby="lab-video-queue" className="overflow-hidden rounded-lg border border-border">
            <div className="max-h-60 overflow-auto" style={{ scrollbarGutter: 'stable' }}>
            <div className="sticky top-0 z-10 grid items-center gap-1 bg-sky px-2 py-1"
              style={{ gridTemplateColumns: 'minmax(0, 1fr) 2.25rem' }}>
              <div className="grid items-center gap-2 px-1" style={{ gridTemplateColumns: '2rem minmax(0, 1fr) minmax(0, .5fr) 5rem' }}>
                <span className="text-sm text-text-2">#</span>
                <h3 id="lab-video-queue" title="Q: previous video · E: next video" className="text-sm font-semibold text-ink">Video queue</h3>
                <span aria-hidden="true" />
                <span className="text-xs text-text-2">{videoQueue.length} {videoQueue.length === 1 ? 'video' : 'videos'}</span>
              </div>
              <button type="button" disabled={running} aria-label="Delete all videos" title="Delete all videos"
                className="grid size-9 place-items-center rounded text-text-2 enabled:hover:bg-white disabled:opacity-40"
                onClick={() => {
                  videoResults.current.clear(); videoReview.current.clear()
                  setVideoQueue([]); showVideo(null); paintVideoOverlay()
                }}><Trash2 aria-hidden="true" size={15} /></button>
            </div>
            <ol className="divide-y divide-border">
              {videoQueue.map((item, index) => {
                const selected = item.id === videoId
                const result = videoResults.current.get(videoResultKey(item.id))
                const itemStatus = result?.status ?? (selected && running ? 'Replaying' : 'Queued')
                const clipState = selected && running ? snapshot : result?.session?.state
                const summary = queueSignSummary(clipState, displayActivity)
                const signText = summary.displayedText
                return <li key={item.id} ref={selected ? selectedQueueRow : undefined} className={`grid items-center gap-1 px-2 ${selected ? 'bg-sky/60' : ''}`}
                  style={{ gridTemplateColumns: 'minmax(0, 1fr) 2.25rem' }}>
                  <button type="button" disabled={running} aria-current={selected ? 'true' : undefined}
                    className="grid min-h-11 min-w-0 items-center gap-2 rounded px-1 text-left text-sm enabled:hover:bg-sky"
                    style={{ gridTemplateColumns: '2rem minmax(0, 1fr) minmax(0, .5fr) 5rem' }}
                    onClick={() => { saveVideoReview(); showVideo(item) }}>
                    <span className="shrink-0 tabular-nums text-text-2">{index + 1}.</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-ink" title={item.file.name}>{item.file.name}</span>
                    <span className="min-w-0 truncate text-right text-xs font-medium text-ink"
                      aria-label={summary.confirmed ? 'Confirmed signs' : 'Unconfirmed prediction'}
                      title={summary.confirmed ? 'Confirmed: ' + signText : summary.labels.length ? 'Most frequent prediction (unconfirmed): ' + signText : 'No predictions yet'}>
                      {summary.confirmed && <span aria-hidden="true">✓ </span>}{signText}</span>
                    <span className={`shrink-0 text-xs ${itemStatus === 'Failed' ? 'text-[#a3372f]' : 'text-text-2'}`}>{itemStatus}</span>
                  </button>
                  <button type="button" disabled={running} aria-label={`Remove ${item.file.name} from queue`}
                    className="grid size-9 shrink-0 place-items-center rounded text-text-2 enabled:hover:bg-sky disabled:opacity-40"
                    onClick={() => {
                      const remaining = videoQueue.filter(entry => entry.id !== item.id)
                      for (const { value } of LAB_MODES) videoResults.current.delete(videoResultKey(item.id, value))
                      videoReview.current.delete(item.id)
                      setVideoQueue(remaining)
                      if (selected) showVideo(remaining[index] ?? remaining[index - 1] ?? null)
                    }}>
                    <X aria-hidden="true" size={15} />
                  </button>
                </li>
              })}
            </ol>
            </div>
          </section>}
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
            <label className="block min-w-0 space-y-1 text-sm font-medium">
              <span>Hand model processor</span>
              <select value={handDelegate} disabled={running || benchmarking || landmarkMode === 'pose'} className={selectClass}
                onChange={event => setHandDelegate(event.target.value === 'CPU' ? 'CPU' : 'GPU')}>
                <option value="GPU">GPU</option>
                <option value="CPU">CPU</option>
              </select>
            </label>
            <label className="block min-w-0 space-y-1 text-sm font-medium">
              <span>Camera capture</span>
              <select value={captureProfile} disabled={running || benchmarking} className={selectClass}
                onChange={event => setCaptureProfile(event.target.value === 'fast' ? 'fast' : '720p')}>
                <option value="720p">1280 × 720</option>
                <option value="fast">640 × 360 (higher frame rate)</option>
              </select>
            </label>
          </div>
          {landmarkMode !== 'hands' && <label className="inline-flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-signal" checked={showPoseLandmarks}
              disabled={benchmarking} onChange={event => setShowPoseLandmarks(event.target.checked)} />
            Show pose landmarks
          </label>}
          {landmarkMode === 'both' && <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-signal" checked={deferPose}
              disabled={running || benchmarking} onChange={event => setDeferPose(event.target.checked)} />
            <span>Run pose after hand landmarks
              <span className="block text-xs text-text-2">Hands are delivered without waiting for the pose model. Pose updates arrive one frame later.</span>
            </span>
          </label>}
          {landmarkMode !== 'pose' && <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-signal" checked={adaptiveHandCapacity}
              disabled={running || benchmarking} onChange={event => setAdaptiveHandCapacity(event.target.checked)} />
            <span>Faster tracking with one hand
              <span className="block text-xs text-text-2">While one hand is shown, skip the search for a second hand on most frames. It still checks every third frame. The timing panel shows “1 max” when active.</span>
            </span>
          </label>}
          {landmarkMode !== 'pose' && <label className="flex min-h-9 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-signal" checked={lowLightAssist}
              disabled={running || benchmarking} onChange={event => setLowLightAssist(event.target.checked)} />
            <span>Low-light assist
              <span className="block text-xs text-text-2">Brightens dark or backlit hands for the landmark detectors only. Frames in normal light are unchanged.</span>
            </span>
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


