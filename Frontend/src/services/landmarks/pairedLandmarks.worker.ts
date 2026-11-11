import { FilesetResolver } from '@mediapipe/tasks-vision'
import { WASM_BASE_URL, createHandLandmarker, createPoseLandmarker } from './visionRuntime'
import type { PairedLandmarksResponse } from './pairedLandmarksWorker'

const scope = globalThis as unknown as {
  postMessage: (result: PairedLandmarksResponse) => void
  onmessage: (event: MessageEvent<{ bitmap: ImageBitmap; timestamp: number }>) => void
  import: (url: string) => Promise<void>
  ModuleFactory: unknown
}

async function initialize() {
  // MediaPipe clears its global factory after each task starts. A module is
  // evaluated only once, so restore the export for the second task or fallback.
  scope.import = async url => {
    scope.ModuleFactory = (await import(/* @vite-ignore */ url)).default
  }
  if (!(await FilesetResolver.isSimdSupported(true))) {
    throw new Error('The MediaPipe module worker requires WebAssembly SIMD support.')
  }
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL, true)
  const hands = { delegate: '', fallback: '' }
  const pose = { delegate: '', fallback: '' }
  const handLandmarker = await createHandLandmarker(fileset, (delegate, fallback = '') => {
    Object.assign(hands, { delegate, fallback })
  })
  const poseLandmarker = await createPoseLandmarker(fileset, (delegate, fallback = '') => {
    Object.assign(pose, { delegate, fallback })
  })

  scope.onmessage = ({ data: { bitmap, timestamp } }) => {
    try {
      const start = performance.now()
      const hands = handLandmarker.detectForVideo(bitmap, timestamp)
      const handEnd = performance.now()
      const pose = poseLandmarker.detectForVideo(bitmap, timestamp)
      scope.postMessage({
        type: 'result', hands, pose, handMs: handEnd - start, poseMs: performance.now() - handEnd,
      })
    } catch (error) {
      scope.postMessage({ type: 'error', message: String(error) })
    } finally {
      bitmap.close()
    }
  }
  scope.postMessage({ type: 'ready', hands, pose })
}

void initialize().catch(error => scope.postMessage({ type: 'error', message: String(error) }))
