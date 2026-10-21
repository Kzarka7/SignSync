import { Input, BlobSource, CanvasSink, MP4, QTFF, WEBM, MATROSKA } from 'mediabunny'

export async function openSourceVideo(file: File, signal: AbortSignal) {
  if (typeof VideoDecoder === 'undefined') throw Error('Source-frame processing needs WebCodecs. Open this collector in a recent Chrome or Edge on localhost or HTTPS.')
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM, MATROSKA] })
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; input.dispose() } }
  const abort = () => dispose()
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw Error('Cannot decode this video codec. Try a browser-compatible MP4 or WebM.')
    const origin = await track.getFirstTimestamp()
    // Preserve the media timeline: phone MP4s can start after time zero.
    // Subtracting their first PTS would desynchronize HTML video playback.
    const duration = await track.computeDuration()
    const width = await track.getDisplayWidth(), height = await track.getDisplayHeight()
    const metrics = await track.computeFrameRateMetrics({ targetPacketCount: Infinity })
    signal.throwIfAborted()
    return { duration, width, height, origin, metrics,
      canvases: (start: number, end: number, maxDimension: number) => {
        const scale = Math.min(1, maxDimension / Math.max(width, height))
        return new CanvasSink(track, { width: Math.round(width * scale), height: Math.round(height * scale), fit: 'contain', poolSize: 1 })
          .canvases(start, end)
      },
      dispose: () => { signal.removeEventListener('abort', abort); dispose() },
    }
  } catch (error) { signal.removeEventListener('abort', abort); dispose(); signal.throwIfAborted(); throw Error(`Cannot decode this file. ${error instanceof Error ? error.message : 'Try a compatible MP4 or WebM.'}`) }
}
