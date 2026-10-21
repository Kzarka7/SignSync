import type { DatasetFrame } from '../../types/dataset'
import type { LandmarkFrameSample, LandmarkPoint, UpperBodyPoseLandmarkName } from '../../types/landmarks'

const HAND_EDGES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]]
const BODY_EDGES: [UpperBodyPoseLandmarkName, UpperBodyPoseLandmarkName][] = [
  ['leftShoulder','rightShoulder'], ['leftShoulder','leftElbow'], ['leftElbow','leftWrist'],
  ['rightShoulder','rightElbow'], ['rightElbow','rightWrist'], ['leftShoulder','leftHip'],
  ['rightShoulder','rightHip'], ['leftHip','rightHip'],
]
export const PREVIEW_COLORS = { left: '#22c55e', right: '#38bdf8', body: '#fbbf24' }

// Use stored timestamps, not an assumed frame count/rate. Never bridge a gap.
export function previewFrame(frames: DatasetFrame[], sourceSeconds: number, start: number, end: number, fps = 20) {
  if (!frames.length || !Number.isFinite(sourceSeconds) || sourceSeconds < start || sourceSeconds >= end) return null
  const timestamp = (sourceSeconds - start) * 1000
  let lo = 0, hi = frames.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (frames[mid].timestamp < timestamp) lo = mid + 1; else hi = mid }
  const before = frames[Math.max(0, lo - 1)], after = frames[Math.min(lo, frames.length - 1)]
  const frame = Math.abs(before.timestamp - timestamp) <= Math.abs(after.timestamp - timestamp) ? before : after
  return Math.abs(frame.timestamp - timestamp) <= 1000 / fps + .001 ? frame : null
}

export function drawVideoLandmarks(ctx: CanvasRenderingContext2D, sample: LandmarkFrameSample, width: number, height: number) {
  // HandLandmarker supplies zero visibility values; only pose visibility is meaningful.
  let checkPoseVisibility = true
  const visible = (p: LandmarkPoint | undefined) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && (!checkPoseVisibility || (p.visibility ?? 1) >= .5)
  const line = (a: LandmarkPoint | undefined, b: LandmarkPoint | undefined) => {
    if (!visible(a) || !visible(b)) return
    ctx.beginPath(); ctx.moveTo(a!.x * width, a!.y * height); ctx.lineTo(b!.x * width, b!.y * height); ctx.stroke()
  }
  const points = (values: LandmarkPoint[]) => values.forEach(p => {
    if (!visible(p)) return
    ctx.beginPath(); ctx.arc(p.x * width, p.y * height, Math.max(2, width / 240), 0, Math.PI * 2); ctx.fill()
  })
  ctx.lineWidth = Math.max(1.5, width / 360)
  ctx.strokeStyle = ctx.fillStyle = PREVIEW_COLORS.body
  if (sample.pose) { BODY_EDGES.forEach(([a,b]) => line(sample.pose![a], sample.pose![b])); points(Object.values(sample.pose)) }
  checkPoseVisibility = false
  for (const [hand, color] of [[sample.leftHand, PREVIEW_COLORS.left], [sample.rightHand, PREVIEW_COLORS.right]] as const) {
    if (!hand) continue
    ctx.strokeStyle = ctx.fillStyle = color
    HAND_EDGES.forEach(([a,b]) => line(hand[a], hand[b])); points(hand)
  }
}
