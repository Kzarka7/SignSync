import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildEvaluationZip, downloadEvaluation } from '../services/dataset/boundaryEvaluation'
import { DEFAULT_LIVE_CAPTURE_PROFILE, OPTIMIZED_LIVE_CAMERA_OPTIONS, useCameraFeed, type CaptureProfile } from './useCameraFeed'
import type { DetectionInputWidth } from '../services/detectionInput'
import type { LandmarkFrameSample } from '../types/landmarks'
import type { IdleCollectionMetadata, LabeledSequence, TrainingCategory } from '../types/dataset'
import {
  clearSequences,
  storageError,
  deleteSequence as deleteStoredSequence,
  getSequences,
  saveSequence,
} from '../services/dataset/datasetStorage'
import { downloadDatasetExport, buildPerSampleZipExport, triggerDownload } from '../services/dataset/datasetExport'
import { startCameraClip } from '../services/dataset/cameraClip'
import { normalizeIdleSequence } from '../services/dataset/idleCollection'
import { DEFAULT_SIGN_LABELS, RETIRED_SIGN_LABELS } from '../services/dataset/signLabelSearch'

// Longest wait for the clip encoder to report it started before frames are
// kept anyway, so a browser that never fires the start event still records.
const CLIP_START_WAIT_MS = 750

function createSequenceId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Owns the Dataset Collector's recording state machine on top of
// useCameraFeed: buffers synchronized hand+pose frames while recording,
// saves them as one LabeledSequence per Start->Stop cycle, and persists
// to IndexedDB via datasetStorage. Camera/detection themselves are
// entirely useCameraFeed's - this hook only adds "what to do with each
// frame while the record button is held down."
interface RecorderOptions {
  training?: LabeledSequence['training']
  trainingBatchId?: string
  trainingCategory?: TrainingCategory
  legacyOnly?: boolean
  signsOnly?: boolean
  scope?: 'training' | 'evaluation'
  evaluationGroup?: 'pilot' | 'idle'
  evaluation?: LabeledSequence['evaluation']
  collection?: IdleCollectionMetadata
  recordingAllowed?: boolean
  hotkeysEnabled?: boolean
  durationLimitMs?: number
}

export function useDatasetRecorder({ collection, recordingAllowed = true, hotkeysEnabled = true, durationLimitMs, scope = 'training', evaluation, evaluationGroup, training, trainingBatchId, trainingCategory, legacyOnly = false, signsOnly = false }: RecorderOptions = {}) {
  const [detectionInputWidth, setDetectionInputWidth] = useState<DetectionInputWidth>(640)
  // Same default as Recognition Lab; 640x360 stays selectable in Camera diagnostics.
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile>(DEFAULT_LIVE_CAPTURE_PROFILE)
  const [allSequences, setSequences] = useState<LabeledSequence[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const savingRef = useRef(false)
  const loadGeneration = useRef(0)
  const [lastSavedSequence, setLastSavedSequence] = useState<LabeledSequence | null>(null)
  const sequences = useMemo(() => allSequences.filter(s =>
    (scope !== 'evaluation' || !evaluationGroup || (s.evaluation?.taskId.startsWith('no-sign-extra-') === (evaluationGroup === 'idle')))
    && (!trainingBatchId || s.training?.batchId === trainingBatchId)
    && (!trainingCategory || s.training?.category === trainingCategory)
    && (!legacyOnly || !s.training)
    && (!signsOnly || (s.training ? s.training.category === 'sign' : !s.collection && !['REST', 'IDLE', 'IDLE_MOVEMENT', 'NO_SIGN', 'INTERRUPTION'].includes(s.label) && !s.label.startsWith('IDLE_')))), [allSequences, scope, evaluationGroup, trainingBatchId, trainingCategory, legacyOnly, signsOnly])
  const [selectedLabel, setSelectedLabel] = useState<string>(DEFAULT_SIGN_LABELS[0])
  const [isRecording, setIsRecording] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [videoCaptureError, setVideoCaptureError] = useState<string | null>(null)
  const [isExportingZip, setIsExportingZip] = useState(false)
  const [zipExport, setZipExport] = useState<{ blob: Blob; filename: string } | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const exportGeneration = useRef(0)
  const exportingRef = useRef(false)

  useEffect(() => {
    // Never offer a ZIP built from an older selection or deleted recordings.
    exportGeneration.current += 1
    exportingRef.current = false
    setZipExport(null)
    setIsExportingZip(false)
    setExportError(null)
    return () => { exportGeneration.current += 1 }
  }, [sequences, selectedLabel, scope])
  // How long Start Recording waits before frames actually start buffering -
  // gives you time to get both hands into position (especially for
  // two-handed signs, where clicking Start with your hands already up
  // means you're holding the pose awkwardly while reaching for the mouse).
  // null = not currently counting down; a number = seconds remaining.
  const [countdownSeconds, setCountdownSeconds] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)

  const bufferRef = useRef<LandmarkFrameSample[]>([])
  const getRecordedFrameCount = useCallback(() => bufferRef.current.length, [])
  // Non-null while a take is active (including the clip start-up wait).
  const recordingStartedAtRef = useRef<number | null>(null)
  // Frames are kept from this time on; Infinity while the clip encoder starts.
  const captureFromRef = useRef(Infinity)
  const takeRef = useRef(0)
  const clipStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const finishClipRef = useRef<ReturnType<typeof startCameraClip> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishRecordingRef = useRef<(discard: boolean) => void>(() => {})
  const recordingContextRef = useRef<{ label: string; collection?: IdleCollectionMetadata; evaluation?: LabeledSequence['evaluation']; training?: LabeledSequence['training']; scope: 'training' | 'evaluation' }>({ label: '', scope: 'training' })

  const refreshSequences = useCallback(async () => {
    const generation = ++loadGeneration.current
    setIsLoading(true)
    try {
      const saved = await getSequences(scope)
      if (generation === loadGeneration.current) { setSequences(saved); setSaveError(null) }
    } catch (error) {
      if (generation === loadGeneration.current) setSaveError(storageError(error))
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false)
    }
  }, [scope])
  useEffect(() => {
    setSequences([])
    void refreshSequences()
    return () => { loadGeneration.current += 1 }
  }, [refreshSequences])

  // Unmount-only: stop any running interval if the component goes away
  // mid-countdown or mid-recording.
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current !== null) {
        clearInterval(countdownIntervalRef.current)
      }
      if (recordingTimeoutRef.current !== null) clearTimeout(recordingTimeoutRef.current)
      if (clipStartTimeoutRef.current !== null) clearTimeout(clipStartTimeoutRef.current)
      takeRef.current += 1
      recordingStartedAtRef.current = null
      captureFromRef.current = Infinity
      void finishClipRef.current?.(true)
      finishClipRef.current = null
    }
  }, [])

  const handleFrame = useCallback((sample: LandmarkFrameSample) => {
    // Latest-frame inference can deliver a preview image captured before Start.
    if (recordingStartedAtRef.current === null || sample.timestamp < captureFromRef.current) return
    bufferRef.current.push(sample)
  }, [])

  const feed = useCameraFeed({
    ...OPTIMIZED_LIVE_CAMERA_OPTIONS,
    onFrame: handleFrame, detectionInputWidth, captureProfile, trackLiveTiming: true,
    // Matches Recognition Lab; adds overlay paint timing to the performance report.
    trackOverlayPaint: true,
  })

  // The actual recording - buffering frames, tracking frame count - starts
  // here, only once the countdown (if any) has finished. Camera detection
  // itself never stops or pauses during the countdown; only whether
  // handleFrame keeps what it sees is gated by captureFromRef.
  //
  // Training takes also record a video clip. Starting its encoder stalls
  // detection briefly, so frames (and the duration limit) start once the
  // encoder reports it is running, or after CLIP_START_WAIT_MS at most.
  const beginKeepingFrames = useCallback((take: number) => {
    if (takeRef.current !== take || recordingStartedAtRef.current === null || captureFromRef.current !== Infinity) return
    if (clipStartTimeoutRef.current !== null) {
      clearTimeout(clipStartTimeoutRef.current)
      clipStartTimeoutRef.current = null
    }
    feed.startPerformanceProfile()
    captureFromRef.current = performance.now()
    if (durationLimitMs && durationLimitMs > 0) {
      recordingTimeoutRef.current = setTimeout(() => finishRecordingRef.current(false), durationLimitMs)
    }
  }, [feed.startPerformanceProfile, durationLimitMs])

  const beginActualRecording = useCallback(() => {
    const take = ++takeRef.current
    bufferRef.current = []
    setSaveError(null)
    setVideoCaptureError(null)
    captureFromRef.current = Infinity
    recordingStartedAtRef.current = performance.now()
    setIsRecording(true)
    let waitForClip = false
    if (recordingContextRef.current.scope === 'training') {
      try {
        const stream = feed.videoRef.current?.srcObject
        if (!(stream instanceof MediaStream)) throw new Error('Camera stream unavailable')
        finishClipRef.current = startCameraClip(stream, () => beginKeepingFrames(take))
        waitForClip = true
      } catch {
        setVideoCaptureError('Video capture could not start. This take will save landmarks only.')
      }
    }
    if (waitForClip && captureFromRef.current === Infinity) {
      clipStartTimeoutRef.current = setTimeout(() => beginKeepingFrames(take), CLIP_START_WAIT_MS)
    } else {
      beginKeepingFrames(take)
    }
  }, [feed.videoRef, beginKeepingFrames])

  const startRecording = useCallback(() => {
    if (savingRef.current || isLoading || !recordingAllowed || recordingStartedAtRef.current !== null) return
    if (!feed.enabled || !feed.cameraReady) return
    if (!selectedLabel.trim()) return
    if (countdownIntervalRef.current !== null) return // already counting down
    recordingContextRef.current = { label: selectedLabel.trim(), collection: collection ? { ...collection } : undefined, evaluation: evaluation ? { ...evaluation } : undefined, training: training ? { ...training } : undefined, scope }

    let remaining = countdownSeconds
    if (remaining <= 0) {
      beginActualRecording()
      return
    }

    setCountdown(remaining)
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1
      if (remaining <= 0) {
        if (countdownIntervalRef.current !== null) {
          clearInterval(countdownIntervalRef.current)
          countdownIntervalRef.current = null
        }
        setCountdown(null)
        beginActualRecording()
      } else {
        setCountdown(remaining)
      }
    }, 1000)
  }, [isLoading, scope, evaluation, training, selectedLabel, countdownSeconds, beginActualRecording, feed.enabled, feed.cameraReady, collection, recordingAllowed])

  // Backs out of a countdown before it finishes - e.g. you clicked Start
  // too early and want to reset. No frames were ever buffered during a
  // countdown, so there's nothing to discard, just the timer to stop.
  const cancelCountdown = useCallback(() => {
    if (countdownIntervalRef.current !== null) {
      clearInterval(countdownIntervalRef.current)
      countdownIntervalRef.current = null
    }
    setCountdown(null)
  }, [])

  // discard=true drops the buffer without saving - used by both
  // discardRecording (explicit) and stopRecording when the buffer ended
  // up empty (e.g. stopped a frame after starting).
  const finishRecording = useCallback(
    async (discard: boolean) => {
      if (recordingStartedAtRef.current === null) return
      if (recordingTimeoutRef.current !== null) {
        clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current = null
      }
      if (clipStartTimeoutRef.current !== null) {
        clearTimeout(clipStartTimeoutRef.current)
        clipStartTimeoutRef.current = null
      }
      takeRef.current += 1
      feed.stopPerformanceProfile()
      recordingStartedAtRef.current = null
      captureFromRef.current = Infinity
      setIsRecording(false)
      const samples = bufferRef.current
      bufferRef.current = []
      const finishClip = finishClipRef.current
      finishClipRef.current = null

      if (discard) {
        void finishClip?.(true)
        return
      }
      if (samples.length === 0) {
        void finishClip?.(true)
        setSaveError('No frames were captured. Check the camera and record again.')
        return
      }

      const durationMs = samples[samples.length - 1].timestamp - samples[0].timestamp
      if (recordingContextRef.current.collection?.kind === 'idle' && durationMs < 2000) {
        void finishClip?.(true)
        setSaveError('Idle clips need at least 2 seconds of captured frames. This clip was not saved; please record again.')
        return
      }
      const trainingContext = recordingContextRef.current.training
      if (trainingContext && (samples.length < 8 || durationMs < 400)) {
        void finishClip?.(true)
        setSaveError('Not enough captured frames or recording time. Please record this task again.')
        return
      }
      const sequence: LabeledSequence = {
        ...(recordingContextRef.current.training ? { training: recordingContextRef.current.training } : {}),
        id: createSequenceId(),
        label: recordingContextRef.current.label,
        ...(recordingContextRef.current.collection ? { collection: recordingContextRef.current.collection } : {}),
        ...(recordingContextRef.current.evaluation ? { evaluation: recordingContextRef.current.evaluation } : {}),
        createdAt: new Date().toISOString(),
        durationMs,
        frames: samples.map(raw => ({ timestamp: raw.timestamp, raw })),
      }

      savingRef.current = true
      setIsSaving(true)
      try {
        if (finishClip) {
          const clip = await finishClip(false)
          if (clip) sequence.cameraClip = clip
          else setVideoCaptureError('The camera video could not be saved. This take has landmarks only.')
        }
        await saveSequence(sequence, recordingContextRef.current.scope)
        // Add the take in memory. Reloading every stored sample (all frames)
        // here blocked the page and the camera loop after each Stop.
        if (recordingContextRef.current.scope === scopeRef.current) {
          const stored = normalizeIdleSequence(sequence)
          setSequences(previous => [...previous.filter(s => s.id !== stored.id), stored])
        }
        setLastSavedSequence(sequence)
      } catch (err) {
        console.error('[useDatasetRecorder] Failed to save sequence:', err)
        setSaveError(storageError(err))
      } finally { savingRef.current = false; setIsSaving(false) }
    },
    [feed.stopPerformanceProfile],
  )

  useEffect(() => { finishRecordingRef.current = finishRecording }, [finishRecording])

  const stopRecording = useCallback(() => finishRecording(false), [finishRecording])
  const discardRecording = useCallback(() => finishRecording(true), [finishRecording])

  // Global hotkeys: Space toggles start/stop (or is a no-op mid-countdown,
  // since startRecording already guards against re-triggering one), Esc
  // cancels a countdown or discards an active recording. The main reason
  // for these: getting into position for a two-handed sign is easier
  // without needing a free hand on the mouse right as you start.
  //
  // Preserve typing and native selection/button activation. Escape still
  // cancels/discards when a recording-control button has focus.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!hotkeysEnabled || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

      if (event.code === 'Space') {
        if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'A') return
        event.preventDefault()
        if (isRecording) {
          stopRecording()
        } else {
          startRecording() // safely no-ops if already counting down or not ready
        }
      } else if (event.code === 'Escape') {
        if (countdown !== null) {
          event.preventDefault()
          cancelCountdown()
        } else if (isRecording) {
          event.preventDefault()
          discardRecording()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hotkeysEnabled, isRecording, countdown, startRecording, stopRecording, discardRecording, cancelCountdown])

  // Deletes update the list in memory instead of reloading every sample.
  const removeStoredSamples = useCallback(async (ids: string[], remove: () => Promise<void>) => {
    if (savingRef.current) return
    savingRef.current = true; setIsSaving(true); setSaveError(null)
    try {
      await remove()
      const removed = new Set(ids)
      setSequences(previous => previous.filter(s => !removed.has(s.id)))
    }
    catch (error) { setSaveError(storageError(error)) }
    finally { savingRef.current = false; setIsSaving(false) }
  }, [])
  const removeSequence = useCallback((id: string) => removeStoredSamples([id], () => deleteStoredSequence(id, scope)), [scope, removeStoredSamples])
  const clearAll = useCallback(() => {
    const ids = sequences.map(s => s.id)
    return removeStoredSamples(ids, () => clearSequences(scope, ids))
  }, [scope, sequences, removeStoredSamples])

  const exportDataset = useCallback(() => {
    setExportError(null)
    try {
      const labels = new Set(sequences.map(s => s.label))
      if (scope === 'evaluation') { downloadEvaluation(sequences); return }
      downloadDatasetExport(sequences, labels.size === 1 ? sequences[0]?.label : undefined)
    } catch {
      setExportError('Could not export JSON. Your recordings are still saved; please try again.')
    }
  }, [sequences, selectedLabel, scope])

  // Same data as exportDataset, split one file per sample and zipped -
  // for triaging (delete a weak sample's file, then merge_dataset.py
  // reassembles what's left) instead of hand-editing one combined JSON.
  const exportPerSampleZip = useCallback(async () => {
    if (exportingRef.current || sequences.length === 0) return
    exportingRef.current = true
    const generation = ++exportGeneration.current
    setIsExportingZip(true)
    setExportError(null)
    try {
      const labels = new Set(sequences.map(s => s.label))
      const archive = scope === 'evaluation' ? await buildEvaluationZip(sequences) : await buildPerSampleZipExport(sequences, labels.size === 1 ? sequences[0]?.label : undefined)
      if (generation === exportGeneration.current) setZipExport(archive)
    } catch {
      if (generation === exportGeneration.current) {
        setExportError('Could not prepare ZIP. Your recordings are still saved; please try again.')
      }
    } finally {
      if (generation === exportGeneration.current) {
        exportingRef.current = false
        setIsExportingZip(false)
      }
    }
  }, [sequences, selectedLabel, scope])

  const downloadZip = useCallback(() => {
    if (!zipExport) return
    setExportError(null)
    try {
      // Called directly from the Download button to keep the browser gesture.
      triggerDownload(zipExport.blob, zipExport.filename)
    } catch {
      setExportError('Download did not start. Try Download ZIP again and check browser download permissions.')
    }
  }, [zipExport])

  // Defaults first (so the picker always offers the seed examples), plus
  // any label that's actually been recorded, deduplicated. Memoized so
  // the array reference only changes when `sequences` actually changes -
  // otherwise LabelPicker (wrapped in React.memo) would still re-render
  // every tick during recording just from receiving a new-but-equal
  // array each time.
  const knownLabels = useMemo(
    () => Array.from(new Set([
      ...DEFAULT_SIGN_LABELS,
      ...sequences.map((s) => s.label).filter(label => !RETIRED_SIGN_LABELS.has(label)),
    ])),
    [sequences],
  )

  return {
    refreshSequences,
    allSequences,
    isLoading,
    isSaving,
    lastSavedSequence,
    detectionInputWidth,
    setDetectionInputWidth,
    captureProfile,
    setCaptureProfile,
    feed,
    getRecordedFrameCount,
    sequences,
    knownLabels,
    selectedLabel,
    setSelectedLabel,
    isRecording,
    saveError,
    videoCaptureError,
    countdown,
    countdownSeconds,
    setCountdownSeconds,
    startRecording,
    cancelCountdown,
    stopRecording,
    discardRecording,
    removeSequence,
    clearAll,
    exportDataset,
    exportPerSampleZip,
    downloadZip,
    isExportingZip,
    zipReady: zipExport !== null,
    exportError,
  }
}
