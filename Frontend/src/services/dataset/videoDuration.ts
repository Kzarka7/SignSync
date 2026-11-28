import { Input, BlobSource, MP4, QTFF, WEBM, MATROSKA } from 'mediabunny'

// MediaRecorder WebMs can omit duration metadata. Read packet timestamps
// without decoding frames or requiring WebCodecs.
export async function readVideoDuration(file: File, signal: AbortSignal) {
  signal.throwIfAborted()
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM, MATROSKA] })
  const abort = () => input.dispose()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw Error('This file has no video track.')
    const duration = await track.computeDuration()
    signal.throwIfAborted()
    return duration
  } finally {
    signal.removeEventListener('abort', abort)
    input.dispose()
  }
}
