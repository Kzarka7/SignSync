import type { HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'

type DelegateStatus = { delegate: string; fallback?: string }

export type PairedLandmarksResponse =
  | { type: 'ready'; hands: DelegateStatus; pose: DelegateStatus }
  | { type: 'result'; hands: HandLandmarkerResult; pose: PoseLandmarkerResult; handMs: number; poseMs: number }
  | { type: 'error'; message: string }

export function createPairedLandmarksWorker() {
  return new Worker(new URL('./pairedLandmarks.worker.ts', import.meta.url), { type: 'module' })
}
