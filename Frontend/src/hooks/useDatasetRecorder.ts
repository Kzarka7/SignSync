import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCameraFeed } from './useCameraFeed'
import type { DetectionInputWidth } from '../services/detectionInput'
import type { LandmarkFrameSample } from '../types/landmarks'
import type { DatasetFrame, IdleCollectionMetadata, LabeledSequence } from '../types/dataset'
import {
  clearSequences,
  deleteSequence as deleteStoredSequence,
  getSequences,
  saveSequence,
} from '../services/dataset/datasetStorage'
import { downloadDatasetExport, buildPerSampleZipExport, triggerDownload } from '../services/dataset/datasetExport'

// Standard signs, supplemented by labels in previously saved recordings.
export const DEFAULT_SIGN_LABELS = ['HELLO', 'WAVE_GREETING', 'THANK_YOU', 'PLEASE', 'SORRY', 'YES', 'NO', 'HELP', 'WELCOME', 'FRIEND', 'FAMILY', 'STAY', 'WAIT', 'WHAT', 'WHY', 'WHERE', 'WHEN', 'WHO', 'WHICH', 'HOW']

function createSequenceId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Owns the Dataset Collector's recording state machine on top of
// useCameraFeed: buffers synchronized hand+pose frames while recording,
// saves them as one LabeledSequence per Start->Stop cycle, and persists
// to localStorage via datasetStorage. Camera/detection themselves are
// entirely useCameraFeed's - this hook only adds "what to do with each
// frame while the record button is held down."
interface RecorderOptions {
  collection?: IdleCollectionMetadata
  recordingAllowed?: boolean
  durationLimitMs?: number
}

export function useDatasetRecorder({ collection, recordingAllowed = true, durationLimitMs }: RecorderOptions = {}) {
  const [detectionInputWidth, setDetectionInputWidth] = useState<DetectionInputWidth>(640)
  const [sequences, setSequences] = useState<LabeledSequence[]>([])
  const [selectedLabel, setSelectedLabel] = useState<string>(DEFAULT_SIGN_LABELS[0])
  const [isRecording, setIsRecording] = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
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
  }, [sequences, selectedLabel])
  // How long Start Recording waits before frames actually start buffering -
  // gives you time to get both hands into position (especially for
  // two-handed signs, where clicking Start with your hands already up
  // means you're holding the pose awkwardly while reaching for the mouse).
  // null = not currently counting down; a number = seconds remaining.
  const [countdownSeconds, setCountdownSeconds] = useState(3)
  const [countdown, setCountdown] = useState<number | null>(null)

  // Frames accumulate here during a recording rather than in state -
  // pushing to a plain array avoids a state update (and re-render) on
  // every single MediaPipe tick; only the *count* is mirrored into state
  // for the live "N frames" readout.
  const bufferRef = useRef<DatasetFrame[]>([])
  // Count completed detection callbacks without rendering for every frame.
  const processedFramesRef = useRef(0)
  // Mirrors isRecording for the onFrame callback, which is created once
  // and reads this on every tick - reading React state directly there
  // would close over a stale value.
  const isRecordingRef = useRef(false)
  // Mirrors the buffered frame count into `frameCount` state on a fixed
  // interval instead of every single onFrame tick (see handleFrame and
  // startRecording) - calling setState on every detection tick guarantees
  // a re-render of the whole page every tick (unlike e.g. handsDetected,
  // which only re-renders when the value actually flips), and that
  // extra, always-on render work was visibly competing with the
  // detection loop for main-thread time - the skeleton overlay noticeably
  // choppier while recording than while just previewing.
  const frameCountIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Ticks the countdown down once per second before actual recording
  // begins - separate from frameCountIntervalRef since the two never run
  // at the same time (countdown finishes, *then* recording starts).
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finishRecordingRef = useRef<(discard: boolean) => void>(() => {})
  const recordingContextRef = useRef<{ label: string; collection?: IdleCollectionMetadata }>({ label: '' })

  useEffect(() => {
    setSequences(getSequences())
  }, [])

  // Unmount-only: stop any running interval if the component goes away
  // mid-countdown or mid-recording.
  useEffect(() => {
    return () => {
      if (frameCountIntervalRef.current !== null) {
        clearInterval(frameCountIntervalRef.current)
      }
      if (countdownIntervalRef.current !== null) {
        clearInterval(countdownIntervalRef.current)
      }
      if (recordingTimeoutRef.current !== null) clearTimeout(recordingTimeoutRef.current)
      isRecordingRef.current = false
    }
  }, [])

  const handleFrame = useCallback((sample: LandmarkFrameSample) => {
    processedFramesRef.current += 1
    if (!isRecordingRef.current) return
    bufferRef.current.push({ timestamp: sample.timestamp, raw: sample })
  }, [])

  const feed = useCameraFeed({ onFrame: handleFrame, detectionInputWidth })

  // The actual recording - buffering frames, tracking frame count - starts
  // here, only once the countdown (if any) has finished. Camera detection
  // itself never stops or pauses during the countdown; only whether
  // handleFrame keeps what it sees is gated by isRecordingRef.
  const beginActualRecording = useCallback(() => {
    feed.startPerformanceProfile()
    bufferRef.current = []
    setFrameCount(0)
    setSaveError(null)
    isRecordingRef.current = true
    setIsRecording(true)

    frameCountIntervalRef.current = setInterval(() => {
      setFrameCount(bufferRef.current.length)
    }, 200)
    if (durationLimitMs && durationLimitMs > 0) {
      recordingTimeoutRef.current = setTimeout(() => finishRecordingRef.current(false), durationLimitMs)
    }
  }, [feed.startPerformanceProfile, durationLimitMs])

  const startRecording = useCallback(() => {
    if (!recordingAllowed || isRecordingRef.current) return
    if (!feed.enabled || !feed.cameraReady) return
    if (!selectedLabel.trim()) return
    if (countdownIntervalRef.current !== null) return // already counting down
    recordingContextRef.current = { label: selectedLabel.trim(), collection: collection ? { ...collection } : undefined }

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
  }, [selectedLabel, countdownSeconds, beginActualRecording, feed.enabled, feed.cameraReady, collection, recordingAllowed])

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
    (discard: boolean) => {
      if (!isRecordingRef.current) return
      if (recordingTimeoutRef.current !== null) {
        clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current = null
      }
      if (frameCountIntervalRef.current !== null) {
        clearInterval(frameCountIntervalRef.current)
        frameCountIntervalRef.current = null
      }
      feed.stopPerformanceProfile()
      isRecordingRef.current = false
      setIsRecording(false)
      const frames = bufferRef.current
      bufferRef.current = []
      setFrameCount(frames.length) // final, exact count, including every captured frame

      if (discard) return
      if (frames.length === 0) {
        setSaveError('No frames were captured. Check the camera and record again.')
        return
      }

      const durationMs =
        frames.length > 1 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0
      if (recordingContextRef.current.collection?.kind === 'idle' && durationMs < 2000) {
        setSaveError('Idle clips need at least 2 seconds of captured frames. This clip was not saved; please record again.')
        return
      }
      const sequence: LabeledSequence = {
        id: createSequenceId(),
        label: recordingContextRef.current.label,
        ...(recordingContextRef.current.collection ? { collection: recordingContextRef.current.collection } : {}),
        createdAt: new Date().toISOString(),
        durationMs,
        frames,
      }

      try {
        saveSequence(sequence)
        setSequences((prev) => [sequence, ...prev])
      } catch (err) {
        console.error('[useDatasetRecorder] Failed to save sequence:', err)
        setSaveError(
          'Could not save this sample - browser storage may be full. Export your dataset, then clear some samples and try again.',
        )
      }
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
      if (event.repeat) return

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
  }, [isRecording, countdown, startRecording, stopRecording, discardRecording, cancelCountdown])

  const removeSequence = useCallback((id: string) => {
    deleteStoredSequence(id)
    setSequences((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    clearSequences()
    setSequences([])
  }, [])

  const exportDataset = useCallback(() => {
    setExportError(null)
    try {
      const labels = new Set(sequences.map(s => s.label))
      downloadDatasetExport(sequences, labels.size === 1 ? sequences[0]?.label : undefined)
    } catch {
      setExportError('Could not export JSON. Your recordings are still saved; please try again.')
    }
  }, [sequences, selectedLabel])

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
      const archive = await buildPerSampleZipExport(sequences, labels.size === 1 ? sequences[0]?.label : undefined)
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
  }, [sequences, selectedLabel])

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
    () => Array.from(new Set([...DEFAULT_SIGN_LABELS, ...sequences.map((s) => s.label)])),
    [sequences],
  )

  return {
    detectionInputWidth,
    setDetectionInputWidth,
    feed,
    processedFramesRef,
    sequences,
    knownLabels,
    selectedLabel,
    setSelectedLabel,
    isRecording,
    frameCount,
    saveError,
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
