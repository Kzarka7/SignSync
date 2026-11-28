const DEFAULT_CLIP_TYPES = ['video/webm;codecs=vp8', 'video/mp4', 'video/webm']

// Live landmark takes prefer H.264: browsers usually encode it on the GPU's
// video encoder, while VP8 is usually encoded on the CPU, competing with
// hand and pose detection. VP8 remains the fallback.
export const LIVE_CLIP_TYPES = ['video/mp4;codecs=avc1.42E01F', 'video/webm;codecs=h264', ...DEFAULT_CLIP_TYPES]

export function createCameraMediaRecorder(stream: MediaStream, videoBitsPerSecond = 8000000, mimeTypes = DEFAULT_CLIP_TYPES): MediaRecorder {
  const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new Error('No supported recording format. Record using your phone and upload the file.')
  return new MediaRecorder(stream, { mimeType, videoBitsPerSecond })
}

// Live landmark takes encode the clip while hand and pose detection run on
// the same machine, so they use a lower rate than the 8 Mbps phone-style
// recording to leave more CPU for detection.
export const LIVE_CLIP_BITS_PER_SECOND = 2500000

export function cameraClipFile(clip: Blob, name: string): File {
  // Chrome labels H.264-in-WebM recordings as Matroska.
  const extension = clip.type.includes('mp4') ? 'mp4' : clip.type.includes('matroska') ? 'mkv' : 'webm'
  return new File([clip], `${name}.${extension}`, { type: clip.type })
}

// onStarted runs once, when the encoder reports it is recording or fails.
// Encoder start-up stalls the page briefly; callers wait for it before
// keeping landmark frames so the stall is not part of the take.
export function startCameraClip(stream: MediaStream, onStarted?: () => void, videoBitsPerSecond = LIVE_CLIP_BITS_PER_SECOND): (discard: boolean) => Promise<Blob | null> {
  const recorder = createCameraMediaRecorder(stream, videoBitsPerSecond, LIVE_CLIP_TYPES)
  const chunks: Blob[] = []
  let discarded = false
  let started = false
  const markStarted = () => {
    if (started) return
    started = true
    onStarted?.()
  }
  const clip = new Promise<Blob | null>(resolve => {
    recorder.onstart = markStarted
    recorder.ondataavailable = event => {
      if (!discarded && event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      discarded = true
      chunks.length = 0
      markStarted()
      resolve(null)
    }
    recorder.onstop = () => {
      resolve(chunks.length && !discarded ? new Blob(chunks, { type: chunks[0].type || recorder.mimeType }) : null)
      chunks.length = 0
    }
  })
  recorder.start(1000)
  return discard => {
    discarded ||= discard
    if (discarded) chunks.length = 0
    if (recorder.state !== 'inactive') recorder.stop()
    return clip
  }
}
