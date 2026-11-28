import { FilesetResolver } from '@mediapipe/tasks-vision'
import { WASM_BASE_URL, createHandLandmarker, createPoseLandmarker, buildFrameSample } from './visionRuntime'
import type { LandmarkFrameSample } from '../../types/landmarks'
import { createStreamingHandAssignment } from '../dataset/videoHandAssignment'

export const REPLAY_FPS = 20
export const MAX_REPLAY_SECONDS = 120

const videoDecodeError = () => Error('Video could not be decoded. Try an MP4 or WebM supported by this browser.')

function loadVideo(video: HTMLVideoElement, url: string, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      video.removeEventListener('loadeddata', loaded)
      video.removeEventListener('error', failed)
      signal.removeEventListener('abort', aborted)
    }
    const loaded = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(videoDecodeError()) }
    const aborted = () => { cleanup(); reject(signal.reason) }
    const timer = setTimeout(failed, 10000)
    video.addEventListener('loadeddata', loaded, { once: true })
    video.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', aborted, { once: true })
    video.src = url
  })
}

export async function replayVideo(file: File, options: {
  video: HTMLVideoElement | null
  signal: AbortSignal
  onFrame: (sample: LandmarkFrameSample) => Promise<void>
  onPreview: (sample: LandmarkFrameSample) => void
  onProgress: (seconds: number, stage: string) => void
}) {
  const began = performance.now()
  const { video, signal } = options
  if (!video) throw Error('The video preview is unavailable.')
  const url = URL.createObjectURL(file)
  let hands: Awaited<ReturnType<typeof createHandLandmarker>> | undefined
  let pose: Awaited<ReturnType<typeof createPoseLandmarker>> | undefined
  const delegates: Record<string, string> = {}
  try {
    options.onProgress(0, 'Opening video')
    video.pause()
    await loadVideo(video, url, signal)
    const { videoWidth: width, videoHeight: height } = video
    let duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) {
      options.onProgress(0, 'Reading video duration')
      const { readVideoDuration } = await import('../dataset/videoDuration')
      duration = await readVideoDuration(file, signal)
    }
    signal.throwIfAborted()
    if (!width || !height) throw videoDecodeError()
    if (!Number.isFinite(duration) || duration <= 0) throw Error('Could not determine this video’s duration. Try exporting it as MP4 or WebM again.')
    if (duration > MAX_REPLAY_SECONDS) {
      throw Error('Choose a video lasting at most ' + MAX_REPLAY_SECONDS + ' seconds.')
    }
    options.onProgress(0, 'Loading hand and pose tracking')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL)
    signal.throwIfAborted()
    const handTracker = hands = await createHandLandmarker(fileset, delegate => { delegates.hand = delegate })
    signal.throwIfAborted()
    const poseTracker = pose = await createPoseLandmarker(fileset, delegate => { delegates.pose = delegate })
    signal.throwIfAborted()
    const assignHands = createStreamingHandAssignment()
    video.defaultPlaybackRate = 1
    video.playbackRate = 1

    let processedFrames = 0
    await new Promise<void>((resolve, reject) => {
      let pending = Promise.resolve()
      let cancelFrame: (() => void) | undefined
      let settled = false, lastBucket = -1, nextProgressAt = 0
      const useVideoFrames = typeof video.requestVideoFrameCallback === 'function'

      const cleanup = () => {
        settled = true
        cancelFrame?.()
        video.removeEventListener('ended', ended)
        video.removeEventListener('error', decodeFailed)
        signal.removeEventListener('abort', aborted)
      }
      const fail = (reason: unknown) => {
        if (settled) return
        cleanup()
        video.pause()
        reject(reason)
      }
      const decodeFailed = () => fail(videoDecodeError())
      const aborted = () => fail(signal.reason)
      const ended = () => {
        cancelFrame?.()
        options.onProgress(duration, 'Finishing recognition')
        void pending.then(() => {
          if (settled) return
          cleanup()
          resolve()
        }, fail)
      }
      const capture = (seconds: number) => {
        const bucket = Math.floor(seconds * REPLAY_FPS + 1e-7)
        if (bucket <= lastBucket || seconds >= duration || video.readyState < 2) return
        lastBucket = bucket
        const timestamp = seconds * 1000
        const detection = handTracker.detectForVideo(video, timestamp)
        const sample = assignHands(buildFrameSample(timestamp, null, poseTracker.detectForVideo(video, timestamp)),
          detection, width / height)
        options.onPreview(sample)
        if (seconds >= nextProgressAt) {
          options.onProgress(seconds, 'Playing video')
          nextProgressAt = seconds + .125
        }
        // Preserve recognition order without making native playback wait for inference.
        pending = pending.then(async () => {
          if (settled) return
          await options.onFrame(sample)
          processedFrames++
        })
        void pending.catch(fail)
      }
      const schedule = () => {
        if (useVideoFrames) {
          const id = video.requestVideoFrameCallback((_, frame) => presented(frame.mediaTime))
          cancelFrame = () => video.cancelVideoFrameCallback(id)
        } else {
          const id = requestAnimationFrame(() => presented(video.currentTime))
          cancelFrame = () => cancelAnimationFrame(id)
        }
      }
      const presented = (seconds: number) => {
        if (settled || video.ended) return
        try {
          if (!video.paused) capture(seconds)
          schedule()
        } catch (error) { fail(error) }
      }

      video.addEventListener('ended', ended, { once: true })
      video.addEventListener('error', decodeFailed, { once: true })
      signal.addEventListener('abort', aborted, { once: true })
      try {
        capture(video.currentTime)
        schedule()
        void video.play().catch(fail)
      } catch (error) { fail(error) }
    })
    return { sampleFps: REPLAY_FPS, width, height, durationSeconds: duration, delegates,
      detectionInput: 'original resolution, unmirrored', decodeMethod: 'playback', playbackRate: 1,
      processedFrames, processingMs: performance.now() - began }
  } finally {
    hands?.close(); pose?.close()
    if (video.getAttribute('src') === url) {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    URL.revokeObjectURL(url)
  }
}

