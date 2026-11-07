import type { VideoQualityWindow } from '../../types/dataset'
import type { processVideo } from './videoImport'
import { assessVideoQuality } from './videoQuality'

type VideoResult = Awaited<ReturnType<typeof processVideo>>

// Reuse actual observations from the completed pass. Do not resample, interpolate
// landmarks, or restart MediaPipe's temporal tracker at the new trim boundary.
export function trimProcessedVideo(source: VideoResult, interval: { start: number; end: number },
  signal: AbortSignal, qualityWindow?: VideoQualityWindow): VideoResult {
  signal.throwIfAborted()
  const began = performance.now()
  const { start, end } = interval
  if (![start, end].every(Number.isFinite) || start < source.start || end > source.end || end <= start || end - start > 120)
    throw Error('Choose a valid interval within the processed recording.')
  const startMs = start * 1000, endMs = end * 1000
  const frames = source.frames.flatMap(frame => {
    const sourceTimestampMs = frame.sourceTimestampMs ?? source.start * 1000 + frame.timestamp
    // Match decoded source selection's inclusive start / exclusive end tolerance.
    if (sourceTimestampMs < startMs - .00001 || sourceTimestampMs >= endMs - .00001) return []
    const timestamp = Math.max(0, sourceTimestampMs - startMs)
    return [{ ...frame, timestamp, raw: { ...frame.raw, timestamp } }]
  })
  const quality = assessVideoQuality(frames, 'either', { endMs: endMs - startMs, fps: source.sampling.effectiveTargetFps }, qualityWindow)
  const processingMs = source.sampling.processingMs + Math.max(.001, performance.now() - began)
  const sampling = { ...source.sampling, selectedFrames: frames.length,
    skippedForTarget: source.sampling.skippedForTarget + source.frames.length - frames.length,
    achievedFps: frames.length > 1 ? (frames.length - 1) * 1000 / (frames[frames.length - 1].timestamp - frames[0].timestamp) : 0,
    processingMs, processingFps: frames.length * 1000 / processingMs,
    reusedFrom: { startMs: source.start * 1000, endMs: source.end * 1000, selectedFrames: source.frames.length } }
  signal.throwIfAborted()
  return { ...source, frames, start, end, quality, qualityWindow, sampling }
}
