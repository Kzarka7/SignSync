import { FilesetResolver } from '@mediapipe/tasks-vision'
import { WASM_BASE_URL, createHandLandmarker, createPoseLandmarker, buildFrameSample } from './visionRuntime'
import type { LandmarkFrameSample } from '../../types/landmarks'
import { createStreamingHandAssignment } from '../dataset/videoHandAssignment'

export const REPLAY_FPS = 20
export const MAX_REPLAY_SECONDS = 120

async function seek(video: HTMLVideoElement, seconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  if (Math.abs(video.currentTime - seconds) < .0001 && video.readyState >= 2) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer); video.removeEventListener('seeked', done)
      video.removeEventListener('error', failed); signal.removeEventListener('abort', aborted)
    }
    const done = () => { cleanup(); resolve() }
    const failed = () => { cleanup(); reject(Error('Video could not be decoded. Try an MP4 supported by this browser.')) }
    const aborted = () => { cleanup(); reject(new DOMException('Replay stopped', 'AbortError')) }
    const timer = setTimeout(failed, 10000)
    video.addEventListener('seeked', done, { once: true }); video.addEventListener('error', failed, { once: true })
    signal.addEventListener('abort', aborted, { once: true })
    video.currentTime = seconds
  })
}

// Deterministic source-time sampling, independent of inference speed. Uses the
// same causal hand assignment as the camera, with a deterministic frame cadence.
export async function replayVideo(video: HTMLVideoElement, options: {
  signal: AbortSignal; onFrame: (sample: LandmarkFrameSample) => Promise<void>
  onProgress: (seconds: number, stage: string) => void
}) {
  if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > MAX_REPLAY_SECONDS) {
    throw Error(`Choose a video lasting at most ${MAX_REPLAY_SECONDS} seconds.`)
  }
  video.pause()
  let hands: Awaited<ReturnType<typeof createHandLandmarker>> | null = null
  let pose: Awaited<ReturnType<typeof createPoseLandmarker>> | null = null
  const delegates: Record<string, string> = {}
  const assignHands = createStreamingHandAssignment()
  try {
    options.onProgress(0, 'Loading hand and pose tracking')
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL)
    options.signal.throwIfAborted()
    hands = await createHandLandmarker(fileset, delegate => { delegates.hand = delegate })
    options.signal.throwIfAborted()
    pose = await createPoseLandmarker(fileset, delegate => { delegates.pose = delegate })
    options.signal.throwIfAborted()
    // End before duration: seeking exactly to the end can return a black frame.
    for (let index = 0; index / REPLAY_FPS < video.duration; index++) {
      const seconds = index / REPLAY_FPS
      await seek(video, seconds, options.signal)
      options.signal.throwIfAborted()
      const timestamp = seconds * 1000
      const handResult = hands.detectForVideo(video, timestamp)
      const sample = assignHands(buildFrameSample(timestamp, null, pose.detectForVideo(video, timestamp)),
        handResult, video.videoWidth / video.videoHeight)
      await options.onFrame(sample)
      options.onProgress(seconds, 'Replaying every window (offline)')
      // Let React paint progress and allow Stop between decoded frames.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    return { sampleFps: REPLAY_FPS, width: video.videoWidth, height: video.videoHeight,
      durationSeconds: video.duration, delegates, detectionInput: 'original resolution, unmirrored' }
  } finally { hands?.close(); pose?.close() }
}
