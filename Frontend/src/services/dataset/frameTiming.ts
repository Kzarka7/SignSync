import type { DatasetFrame } from '../../types/dataset'

export function medianFrameStep(frames: DatasetFrame[], fallback = 50) {
  const deltas = frames.slice(1).map((frame, i) => frame.timestamp - frames[i].timestamp).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  return deltas.length ? deltas[Math.floor(deltas.length / 2)] : fallback
}
export function frameSpan(frames: DatasetFrame[], index: number, fallback = 50, endMs = Infinity) {
  const next = frames[index + 1]?.timestamp ?? frames[index].timestamp + fallback
  return Math.max(0, Math.min(endMs, next) - frames[index].timestamp)
}

// One selected frame per target time bucket, never synthetic timestamps or images.
export function sourceFrameSelector(fps: number, start: number, end: number, retainSourceCadence = false) {
  let previous = -Infinity, bucket = -1
  let decodedFrames = 0, duplicateTimestamps = 0, skippedForTarget = 0
  return {
    accept(seconds: number) {
      if (!Number.isFinite(seconds)) throw Error('Non-finite source frame timestamp.')
      if (seconds < start - 1e-8 || seconds >= end - 1e-8) return false
      decodedFrames++
      if (seconds < previous - 1e-8) throw Error('Source timestamps are not in presentation order.')
      if (Math.abs(seconds - previous) < 1e-8) { duplicateTimestamps++; return false }
      previous = seconds
      if (retainSourceCadence) return true
      const current = Math.floor((seconds - start) * fps + 1e-6)
      if (current <= bucket) { skippedForTarget++; return false }
      bucket = current
      return true
    },
    stats: () => ({ decodedFrames, duplicateTimestamps, skippedForTarget }),
  }
}
