// Shared shapes for MediaPipe landmark data, produced by useCameraFeed and
// consumed by anything that needs synchronized hand + pose data for a
// single frame - today that's just the live skeleton overlay, but this is
// also the schema the future dataset collector (Camera -> Hand + Pose
// Landmarks -> Dataset -> ML training) will record per frame.

// A single normalized landmark point, as returned by MediaPipe Tasks
// Vision. x/y are normalized 0-1 against frame width/height, z is relative
// depth (hand landmarks always have it; pose landmarks also carry
// visibility - how confident the model is the point isn't occluded).
export interface LandmarkPoint {
  x: number
  y: number
  z: number
  visibility?: number
}

export type Handedness = 'Left' | 'Right'

export interface HandLandmarkFrame {
  handedness: Handedness
  // All 21 HandLandmarker points, in MediaPipe's standard order (wrist,
  // thumb, index, middle, ring, pinky) - unchanged from what the hand
  // detection loop already produced.
  landmarks: LandmarkPoint[]
}

// Upper-body-only subset of PoseLandmarker's 33 points. Sign language
// meaning lives in the hands, arms, shoulders, and general torso
// orientation - hips are kept as a stable reference for torso lean/rotation,
// but legs/face-mesh-adjacent points (eyes, ears, mouth, feet) add noise
// without adding signal here, so they're dropped rather than carried
// through the whole pipeline unused.
export const UPPER_BODY_POSE_LANDMARK_NAMES = [
  'nose',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftHip',
  'rightHip',
] as const

export type UpperBodyPoseLandmarkName = (typeof UPPER_BODY_POSE_LANDMARK_NAMES)[number]

export type PoseLandmarkFrame = Record<UpperBodyPoseLandmarkName, LandmarkPoint>

// One synchronized detection tick: both landmarkers are run against the
// same video frame/timestamp, so these three fields always describe the
// same instant - this is the unit a dataset sample's per-frame array
// should be made of.
export interface LandmarkFrameSample {
  // performance.now()-relative, matching the timestamp fed to
  // detectForVideo() - see the comment on lastTimestampRef in
  // useCameraFeed for why this (not video.currentTime) is used.
  timestamp: number
  leftHand: LandmarkPoint[] | null
  rightHand: LandmarkPoint[] | null
  pose: PoseLandmarkFrame | null
}
