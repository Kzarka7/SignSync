import { FilesetResolver } from '@mediapipe/tasks-vision'
import { WASM_BASE_URL, createHandLandmarker, createPoseLandmarker, buildFrameSample } from '../landmarks/visionRuntime'
import type { DatasetFrame, VideoImportMetadata, VideoQualityWindow } from '../../types/dataset'
import { assessVideoQuality, assessBoundaryVideoQuality } from './videoQuality'
import { sourceFrameSelector } from './frameTiming'
import { assignVideoHands, swapVideoHands, type VideoHandDetection } from './videoHandAssignment'
import { detectVideoHandContact } from './videoHandOverlap'
import { createLowLightInput, LOW_LIGHT_MAX_DIMENSION, stabilizeLowLightFrames } from './lowLightTracking'

export const VIDEO_IMPORT_VERSION = 'video-import-v5-mp0.10.35-gesture-context'
export const IMPORT_FPS = 30
export const BOUNDARY_IMPORT_VERSION = 'video-import-v6-mp0.10.35-boundary'

export async function fingerprintVideo(file: File) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('')
}

export async function processVideo(file: File, signal: AbortSignal, onProgress: (percent: number) => void,
  interval?: { start: number; end: number }, options: { maxDimension?: number; targetFps?: number; qualityWindow?: VideoQualityWindow; samplePurpose?: 'rest' | 'idle_movement'; swapHandSides?: boolean; lowLight?: boolean } = {}) {
  const lowLight = !!options.lowLight && !options.samplePurpose
  const maxDimension = options.maxDimension ?? (lowLight ? LOW_LIGHT_MAX_DIMENSION : 640), targetFps = options.targetFps ?? IMPORT_FPS
  if (![640, 960, 1280].includes(maxDimension)) throw Error('Unsupported tracking resolution.')
  if (![20, 30, 60].includes(targetFps)) throw Error('Choose 20, 30 or 60 target FPS.')
  if (options.samplePurpose && (!['rest', 'idle_movement'].includes(options.samplePurpose) || options.qualityWindow)) throw Error('Non-sign footage requires full-interval quality assessment.')
  signal.throwIfAborted()
  const began = performance.now()
  const { openSourceVideo } = await import('./sourceVideo')
  const source = await openSourceVideo(file, signal)
  let hands: Awaited<ReturnType<typeof createHandLandmarker>> | undefined
  let pose: Awaited<ReturnType<typeof createPoseLandmarker>> | undefined
  try {
    const { duration, width, height } = source
    const start = interval?.start ?? 0, end = interval?.end ?? duration
    if (![duration, start, end, width, height].every(Number.isFinite) || duration <= 0 || width <= 0 || height <= 0 || start < 0 || end > duration || end <= start || end - start > 120)
      throw Error('Choose a valid interval of at most 120 seconds within the video.')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL)
    signal.throwIfAborted()
    hands = await createHandLandmarker(fileset, () => {})
    signal.throwIfAborted()
    pose = await createPoseLandmarker(fileset, () => {})
    signal.throwIfAborted()
    const enhance = lowLight ? createLowLightInput() : undefined
    // Near-target recordings jitter across bucket boundaries. Preserve that real
    // cadence rather than discarding adjacent frames from a nominal 30 FPS camera.
    const retainSourceCadence = source.metrics.averageFrameRate <= targetFps * 1.02
    const selector = sourceFrameSelector(targetFps, start, end, retainSourceCadence)
    const observations: { frame: DatasetFrame; hands: VideoHandDetection[] }[] = []
    let inputWidth = 0, inputHeight = 0
    for await (const frame of source.canvases(start, end, maxDimension)) {
      signal.throwIfAborted()
      const seconds = frame.timestamp
      if (!selector.accept(seconds)) continue
      const timestamp = Math.max(0, (seconds - start) * 1000)
      inputWidth = frame.canvas.width; inputHeight = frame.canvas.height
      const detection = hands.detectForVideo(frame.canvas, timestamp)
      const raw = buildFrameSample(timestamp, null, pose.detectForVideo(frame.canvas, timestamp))
      const candidates = detection.landmarks.flatMap((landmarks, index): VideoHandDetection[] => {
        if (landmarks.length !== 21 || !landmarks.every(({ x, y, z }) => [x, y, z].every(Number.isFinite))) return []
        const category = detection.handedness[index]?.[0]
        const name = category?.categoryName
        return [{ landmarks, handedness: name === 'Left' || name === 'Right' ? name : undefined, score: category?.score ?? 0 }]
      })
      observations.push({ frame: { timestamp, raw, sourceTimestampMs: seconds * 1000, sourceDurationMs: frame.duration * 1000 }, hands: candidates })
      onProgress(Math.min(99, Math.round((seconds - start) / (end - start) * 100)))
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    signal.throwIfAborted()
    let frames = assignVideoHands(observations)
    if (lowLight && frames.length) frames = stabilizeLowLightFrames(frames, inputWidth / inputHeight)
    if (!options.samplePurpose) {
      const contact = detectVideoHandContact(frames, inputWidth / inputHeight)
      if (contact.some(Boolean)) frames = assignVideoHands(observations, contact)
    }
    if (options.swapHandSides) frames = swapVideoHands(frames)
    const elapsed = performance.now() - began
    const effectiveTargetFps = Math.min(targetFps, source.metrics.medianFrameRate)
    const sampling: NonNullable<VideoImportMetadata['sampling']> = { method: 'decoded-source-frames-v1', requestedFps: targetFps,
      effectiveTargetFps, sourceAverageFps: source.metrics.averageFrameRate, sourceMedianFps: source.metrics.medianFrameRate,
      variableFrameRate: source.metrics.underlyingFrameRate === null, sourceTimeOriginSeconds: source.origin,
      achievedFps: frames.length > 1 ? (frames.length - 1) * 1000 / (frames[frames.length - 1].timestamp - frames[0].timestamp) : 0,
      ...selector.stats(), selectedFrames: frames.length, processingMs: elapsed, processingFps: frames.length * 1000 / elapsed }
    return { frames, lowLight, qualityWindow: options.qualityWindow, quality: options.samplePurpose
      ? assessBoundaryVideoQuality(frames, options.samplePurpose, 'either', { endMs: (end - start) * 1000, fps: effectiveTargetFps })
      : assessVideoQuality(frames, 'either', { endMs: end * 1000 - start * 1000, fps: effectiveTargetFps }, options.qualityWindow),
      start, end, duration, width, height, inputWidth, inputHeight, maxDimension, sampling }
  } finally { hands?.close(); pose?.close(); source.dispose() }
}
