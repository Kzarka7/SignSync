import {
  UPPER_BODY_POSE_LANDMARK_NAMES,
  type LandmarkFrameSample,
  type LandmarkPoint,
  type PoseLandmarkFrame,
} from '../../types/landmarks'
import type { FeatureSchema } from '../../types/dataset'

// --- Normalization ---------------------------------------------------------
//
// Raw landmarks from useCameraFeed are in image-normalized coordinates
// (0-1 across the frame), which bakes in camera distance and where the
// signer happens to stand - useless for a model that needs to recognize
// the same sign regardless of either. Both problems have one fix: express
// every point relative to the signer's own body instead of the camera
// frame.
//
// Origin: the shoulder midpoint. Scale: shoulder width. Both pose and hand
// landmarks get the same transform, which - importantly - keeps hand
// position *relative to the torso* meaningful (e.g. a sign made near the
// face vs. at waist height are meaningfully different, and that
// difference survives normalization instead of being thrown away).

// Minimum shoulder width (in normalized 0-1 image coordinates) below which
// a frame is treated as unusable as a normalization reference - guards
// against dividing by a near-zero scale when shoulders are barely apart
// (signer mostly out of frame, turned sideways, or a bad pose detection).
const MIN_SHOULDER_WIDTH = 0.02

function distance(a: LandmarkPoint, b: LandmarkPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

function normalizePoint(
  point: LandmarkPoint,
  originX: number,
  originY: number,
  scale: number,
): LandmarkPoint {
  return {
    x: (point.x - originX) / scale,
    y: (point.y - originY) / scale,
    z: point.z / scale,
    visibility: point.visibility,
  }
}

export interface NormalizedFrame {
  pose: PoseLandmarkFrame
  leftHand: LandmarkPoint[] | null
  rightHand: LandmarkPoint[] | null
}

// Returns null when the frame has no usable normalization reference (no
// pose detected, or shoulders too close together for a stable scale) -
// callers should treat that as "no valid features for this frame" (see
// toFeatureVector, which zero-fills in that case rather than throwing).
export function normalizeFrame(sample: LandmarkFrameSample): NormalizedFrame | null {
  const pose = sample.pose
  if (!pose) return null

  const originX = (pose.leftShoulder.x + pose.rightShoulder.x) / 2
  const originY = (pose.leftShoulder.y + pose.rightShoulder.y) / 2
  const scale = distance(pose.leftShoulder, pose.rightShoulder)
  if (!Number.isFinite(scale) || scale < MIN_SHOULDER_WIDTH) return null

  const normalizedPose = {} as PoseLandmarkFrame
  for (const name of UPPER_BODY_POSE_LANDMARK_NAMES) {
    normalizedPose[name] = normalizePoint(pose[name], originX, originY, scale)
  }

  return {
    pose: normalizedPose,
    leftHand: sample.leftHand?.map((p) => normalizePoint(p, originX, originY, scale)) ?? null,
    rightHand: sample.rightHand?.map((p) => normalizePoint(p, originX, originY, scale)) ?? null,
  }
}

// --- Flattening into a fixed-length feature vector -------------------------
//
// A GRU/LSTM wants a (frames, features) array per sample, which means
// every frame - whether or not a hand happened to be visible - needs the
// same number of features in the same order. Missing hands are zero-filled
// with an explicit presence flag rather than omitted, so "hand absent" is
// still a learnable signal instead of silently shifting every later value.

const POSE_FEATURES_PER_POINT = 4 // x, y, z, visibility
const HAND_LANDMARK_COUNT = 21
const HAND_FEATURES_PER_POINT = 3 // x, y, z - HandLandmarker has no visibility

const POSE_VECTOR_LENGTH = UPPER_BODY_POSE_LANDMARK_NAMES.length * POSE_FEATURES_PER_POINT // 9 * 4 = 36
const HAND_VECTOR_LENGTH = HAND_LANDMARK_COUNT * HAND_FEATURES_PER_POINT // 21 * 3 = 63

// pose(36) + leftPresent(1) + leftHand(63) + rightPresent(1) + rightHand(63) = 164
export const FEATURE_VECTOR_LENGTH =
  POSE_VECTOR_LENGTH + 1 + HAND_VECTOR_LENGTH + 1 + HAND_VECTOR_LENGTH

// MediaPipe HandLandmarker's fixed 21-point order - used only to label the
// exported feature schema, doesn't affect the actual math.
const HAND_LANDMARK_NAMES = [
  'wrist',
  'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  'index_mcp', 'index_pip', 'index_dip', 'index_tip',
  'middle_mcp', 'middle_pip', 'middle_dip', 'middle_tip',
  'ring_mcp', 'ring_pip', 'ring_dip', 'ring_tip',
  'pinky_mcp', 'pinky_pip', 'pinky_dip', 'pinky_tip',
]

function buildFeatureOrder(): string[] {
  const order: string[] = []
  for (const name of UPPER_BODY_POSE_LANDMARK_NAMES) {
    order.push(`pose.${name}.x`, `pose.${name}.y`, `pose.${name}.z`, `pose.${name}.visibility`)
  }
  order.push('leftHand.present')
  for (const name of HAND_LANDMARK_NAMES) {
    order.push(`leftHand.${name}.x`, `leftHand.${name}.y`, `leftHand.${name}.z`)
  }
  order.push('rightHand.present')
  for (const name of HAND_LANDMARK_NAMES) {
    order.push(`rightHand.${name}.x`, `rightHand.${name}.y`, `rightHand.${name}.z`)
  }
  return order
}

export const FEATURE_ORDER = buildFeatureOrder()

export const NORMALIZATION_DESCRIPTION = {
  method: 'shoulder-centered, shoulder-width-scaled',
  origin: 'midpoint of pose.leftShoulder and pose.rightShoulder',
  scale:
    'euclidean distance between pose.leftShoulder and pose.rightShoulder, in normalized image coordinates',
}

export function buildFeatureSchema(): FeatureSchema {
  return {
    length: FEATURE_VECTOR_LENGTH,
    order: FEATURE_ORDER,
    normalization: NORMALIZATION_DESCRIPTION,
  }
}

// Flattens one frame into the fixed-length vector described by
// FEATURE_ORDER/buildFeatureSchema. Always exactly FEATURE_VECTOR_LENGTH
// numbers long. `valid: false` means normalization failed for this frame
// (see normalizeFrame) and the vector is all zeros - training code can
// filter these out or mask them, whichever fits the model.
export function toFeatureVector(sample: LandmarkFrameSample): { features: number[]; valid: boolean } {
  const normalized = normalizeFrame(sample)
  if (!normalized) {
    return { features: new Array(FEATURE_VECTOR_LENGTH).fill(0), valid: false }
  }

  const features: number[] = []
  for (const name of UPPER_BODY_POSE_LANDMARK_NAMES) {
    const p = normalized.pose[name]
    features.push(p.x, p.y, p.z, p.visibility ?? 0)
  }

  features.push(normalized.leftHand ? 1 : 0)
  if (normalized.leftHand) {
    for (const p of normalized.leftHand) features.push(p.x, p.y, p.z)
  } else {
    for (let i = 0; i < HAND_VECTOR_LENGTH; i++) features.push(0)
  }

  features.push(normalized.rightHand ? 1 : 0)
  if (normalized.rightHand) {
    for (const p of normalized.rightHand) features.push(p.x, p.y, p.z)
  } else {
    for (let i = 0; i < HAND_VECTOR_LENGTH; i++) features.push(0)
  }

  return { features, valid: true }
}
