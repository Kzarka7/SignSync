import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCameraFeed } from './useCameraFeed'
import type { LandmarkFrameSample } from '../types/landmarks'
import type { DatasetFrame, LabeledSequence } from '../types/dataset'
import {
  clearSequences,
  deleteSequence as deleteStoredSequence,
  getSequences,
  saveSequence,
} from '../services/dataset/datasetStorage'
import { downloadDatasetExport } from '../services/dataset/datasetExport'

// Seeds the label picker - the examples from the product brief. Any
// custom label typed into the collector joins this list for the rest of
// the session (see knownLabels below), so this is a starting point, not a
// fixed enum.
export const DEFAULT_SIGN_LABELS = ['HELLO', 'GOOD_BYE', 'THANK_YOU', 'PLEASE', 'SORRY', 'YES', 'NO', 'HELP', 'STOP', 'WAIT', 'MORE', 'WATER', 'FOOD', 'PAIN', 'DOCTOR', 'MEDICINE', 'WHERE', 'WHAT', 'WHO', 'UNDERSTAND' ]

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
export function useDatasetRecorder() {
  const [sequences, setSequences] = useState<LabeledSequence[]>([])
  const [selectedLabel, setSelectedLabel] = useState<string>(DEFAULT_SIGN_LABELS[0])
  const [isRecording, setIsRecording] = useState(false)
  const [frameCount, setFrameCount] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Frames accumulate here during a recording rather than in state -
  // pushing to a plain array avoids a state update (and re-render) on
  // every single MediaPipe tick; only the *count* is mirrored into state
  // for the live "N frames" readout.
  const bufferRef = useRef<DatasetFrame[]>([])
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

  useEffect(() => {
    setSequences(getSequences())
  }, [])

  // Unmount-only: stop the interval if the component goes away mid-recording.
  useEffect(() => {
    return () => {
      if (frameCountIntervalRef.current !== null) {
        clearInterval(frameCountIntervalRef.current)
      }
    }
  }, [])

  const handleFrame = useCallback((sample: LandmarkFrameSample) => {
    if (!isRecordingRef.current) return
    bufferRef.current.push({ timestamp: sample.timestamp, raw: sample })
  }, [])

  const feed = useCameraFeed({ onFrame: handleFrame })

  const startRecording = useCallback(() => {
    if (!selectedLabel.trim()) return
    bufferRef.current = []
    setFrameCount(0)
    setSaveError(null)
    isRecordingRef.current = true
    setIsRecording(true)

    frameCountIntervalRef.current = setInterval(() => {
      setFrameCount(bufferRef.current.length)
    }, 200)
  }, [selectedLabel])

  // discard=true drops the buffer without saving - used by both
  // discardRecording (explicit) and stopRecording when the buffer ended
  // up empty (e.g. stopped a frame after starting).
  const finishRecording = useCallback(
    (discard: boolean) => {
      if (frameCountIntervalRef.current !== null) {
        clearInterval(frameCountIntervalRef.current)
        frameCountIntervalRef.current = null
      }
      isRecordingRef.current = false
      setIsRecording(false)
      const frames = bufferRef.current
      bufferRef.current = []
      setFrameCount(frames.length) // final, exact count

      if (discard || frames.length === 0) return

      const durationMs =
        frames.length > 1 ? frames[frames.length - 1].timestamp - frames[0].timestamp : 0
      const sequence: LabeledSequence = {
        id: createSequenceId(),
        label: selectedLabel.trim(),
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
    [selectedLabel],
  )

  const stopRecording = useCallback(() => finishRecording(false), [finishRecording])
  const discardRecording = useCallback(() => finishRecording(true), [finishRecording])

  const removeSequence = useCallback((id: string) => {
    deleteStoredSequence(id)
    setSequences((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    clearSequences()
    setSequences([])
  }, [])

  const exportDataset = useCallback(() => {
    downloadDatasetExport(sequences, selectedLabel)
  }, [sequences, selectedLabel])

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
    feed,
    sequences,
    knownLabels,
    selectedLabel,
    setSelectedLabel,
    isRecording,
    frameCount,
    saveError,
    startRecording,
    stopRecording,
    discardRecording,
    removeSequence,
    clearAll,
    exportDataset,
  }
}