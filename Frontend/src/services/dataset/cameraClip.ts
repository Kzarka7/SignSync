export function createCameraMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = ['video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
  if (!mimeType) throw new Error('No supported recording format. Record using your phone and upload the file.')
  return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 })
}

export function cameraClipFile(clip: Blob, name: string): File {
  const extension = clip.type.includes('mp4') ? 'mp4' : 'webm'
  return new File([clip], `${name}.${extension}`, { type: clip.type })
}

export function startCameraClip(stream: MediaStream): (discard: boolean) => Promise<Blob | null> {
  const recorder = createCameraMediaRecorder(stream)
  const chunks: Blob[] = []
  let discarded = false
  const clip = new Promise<Blob | null>(resolve => {
    recorder.ondataavailable = event => {
      if (!discarded && event.data.size) chunks.push(event.data)
    }
    recorder.onerror = () => {
      discarded = true
      chunks.length = 0
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
