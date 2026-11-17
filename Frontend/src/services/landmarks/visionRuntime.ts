import { FilesetResolver, HandLandmarker, PoseLandmarker, type HandLandmarkerResult, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { UPPER_BODY_POSE_LANDMARK_NAMES, type HandLandmarkFrame, type LandmarkFrameSample, type LandmarkPoint, type PoseLandmarkFrame, type UpperBodyPoseLandmarkName } from '../../types/landmarks'

const VISION_ASSETS = '/vision/0.10.35'
export const WASM_BASE_URL = `${VISION_ASSETS}/wasm`
export const HAND_MODEL_URL = `${VISION_ASSETS}/hand_landmarker.task`
export const POSE_MODEL_URL = `${VISION_ASSETS}/pose_landmarker_lite.task`

// Indices into PoseLandmarker's standard 33-point output for the
// upper-body subset we keep - see UPPER_BODY_POSE_LANDMARK_NAMES in
// ../types/landmarks for why the rest (face mesh, legs, feet) are dropped.
export const UPPER_BODY_POSE_INDEX: Record<UpperBodyPoseLandmarkName, number> = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
export type PoseLandmarks = Pick<PoseLandmarkerResult, 'landmarks'>;
export type HandCapacity = 1 | 2;
const SHOULDER_VISIBILITY = 0.5;
const WRIST_VISIBILITY = 0.65;

function visiblePoint(point: LandmarkPoint | undefined, threshold: number): point is LandmarkPoint {
  return !!point && (point.visibility ?? 0) >= threshold && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export async function createHandLandmarker(
  fileset: VisionFileset,
  report: (delegate: string, fallback?: string) => void,
  relaxedTracking = false,
  numHands: HandCapacity = 2,
): Promise<HandLandmarker> {
  const options = {
    runningMode: "VIDEO" as const,
    numHands,
    minHandDetectionConfidence: relaxedTracking ? 0.45 : 0.5,
    minHandPresenceConfidence: relaxedTracking ? 0.25 : 0.5,
    minTrackingConfidence: relaxedTracking ? 0.30 : 0.5,
  };
  try {
    const model = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
      ...options,
    });
    report("GPU");
    return model;
  } catch (gpuErr) {
    console.warn(
      "[useCameraFeed] GPU delegate unavailable for hand model, falling back to CPU:",
      gpuErr,
    );
    const model = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "CPU" },
      ...options,
    });
    report("CPU", String(gpuErr));
    return model;
  }
}

export function filterHandsByPoseWrist(
  result: HandLandmarkerResult | null,
  poseResult: PoseLandmarks | null,
  aspect: number,
): HandLandmarkerResult | null {
  const pose = poseResult?.landmarks[0];
  if (!result?.landmarks.length || !pose || !Number.isFinite(aspect) || aspect <= 0) return result;

  const { leftShoulder, rightShoulder, leftWrist, rightWrist } = UPPER_BODY_POSE_INDEX;
  const distance = (a: LandmarkPoint, b: LandmarkPoint) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const left = pose[leftShoulder], right = pose[rightShoulder];
  if (!visiblePoint(left, SHOULDER_VISIBILITY) || !visiblePoint(right, SHOULDER_VISIBILITY)) return result;

  const maxDistance = 0.25 * distance(left, right);
  const wrists = [pose[leftWrist], pose[rightWrist]].filter(wrist => visiblePoint(wrist, WRIST_VISIBILITY));
  if (!Number.isFinite(maxDistance) || maxDistance <= 0 || !wrists.length) return result;

  const kept = result.landmarks.flatMap((hand, index) => wrists.some(wrist =>
    hand[0] && distance(hand[0], wrist) <= maxDistance) ? [index] : []);
  if (kept.length === result.landmarks.length) return result;

  const handedness = kept.map(index => result.handedness[index]);
  return {
    landmarks: kept.map(index => result.landmarks[index]),
    worldLandmarks: kept.map(index => result.worldLandmarks[index]),
    handedness,
    handednesses: handedness,
  };
}

export function smoothPoseShoulders(previous: PoseLandmarks | null, fresh: PoseLandmarks | null): PoseLandmarks | null {
  const points = fresh?.landmarks[0];
  if (!points?.length) return null;
  const last = previous?.landmarks[0];
  if (!last) return fresh;

  const smoothed = points.slice();
  for (const index of [UPPER_BODY_POSE_INDEX.leftShoulder, UPPER_BODY_POSE_INDEX.rightShoulder]) {
    const before = last[index], after = points[index];
    if (!visiblePoint(before, SHOULDER_VISIBILITY) || !visiblePoint(after, SHOULDER_VISIBILITY)
      || !Number.isFinite(before.z) || !Number.isFinite(after.z)) continue;
    smoothed[index] = { ...after, x: (before.x + after.x) / 2, y: (before.y + after.y) / 2, z: (before.z + after.z) / 2 };
  }
  return { landmarks: [smoothed] };
}

export function countRaisedPoseWrists(result: PoseLandmarks | null): 0 | HandCapacity | null {
  const pose = result?.landmarks[0];
  if (!pose) return null;
  const { leftWrist, rightWrist, leftHip, rightHip } = UPPER_BODY_POSE_INDEX;
  const hips = [pose[leftHip], pose[rightHip]];
  const wrists = [pose[leftWrist], pose[rightWrist]];
  if (![...hips, ...wrists].every(point => visiblePoint(point, WRIST_VISIBILITY))) return null;
  const torsoBottom = Math.max(...hips.map(hip => hip.y));
  const leftRaised = wrists[0].y <= torsoBottom, rightRaised = wrists[1].y <= torsoBottom;
  return leftRaised && rightRaised ? 2 : leftRaised || rightRaised ? 1 : 0;
}

export function createHandCapacityController() {
  let limit: HandCapacity = 2;
  let streak = 0;
  return {
    get limit() { return limit; },
    observe(raisedWrists: ReturnType<typeof countRaisedPoseWrists>) {
      if (raisedWrists === null) {
        // With uncertain pose, leave room for a second hand.
        limit = 2;
        streak = 0;
      } else if (raisedWrists === 0 || raisedWrists === limit) {
        streak = 0;
      } else if (++streak >= (raisedWrists === 2 ? 3 : 9)) {
        limit = raisedWrists;
        streak = 0;
      }
    },
  };
}

export async function createPoseLandmarker(
  fileset: VisionFileset,
  report: (delegate: string, fallback?: string) => void,
): Promise<PoseLandmarker> {
  const options = {
    runningMode: "VIDEO" as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    const model = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "GPU" },
      ...options,
    });
    report("GPU");
    return model;
  } catch (gpuErr) {
    console.warn(
      "[useCameraFeed] GPU delegate unavailable for pose model, falling back to CPU:",
      gpuErr,
    );
    const model = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: "CPU" },
      ...options,
    });
    report("CPU", String(gpuErr));
    return model;
  }
}

// MediaPipe's NormalizedLandmark already has this exact shape; this just
// gives call sites a stable, explicit conversion point (and a single place
// to adjust if that shape ever changes) rather than passing MediaPipe's
// type straight into the dataset-facing LandmarkPoint type.
function toLandmarkPoint(landmark: {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}): LandmarkPoint {
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility,
  };
}

// Reduces one HandLandmarker detection into the left/right hand shape
// the rest of the app (and the eventual dataset) expects, using the
// per-hand handedness category MediaPipe returns alongside landmarks.
// If two hands report the same side (rare misclassification), the
// higher-confidence one wins and the other is dropped rather than
// silently overwritten.
function splitHandsByHandedness(result: HandLandmarkerResult): {
  left: HandLandmarkFrame | null;
  right: HandLandmarkFrame | null;
} {
  let left: HandLandmarkFrame | null = null;
  let leftScore = 0;
  let right: HandLandmarkFrame | null = null;
  let rightScore = 0;

  result.landmarks.forEach((landmarks, i) => {
    const category = result.handedness[i]?.[0];
    if (!category) return;

    const frame: HandLandmarkFrame = {
      handedness: category.categoryName as "Left" | "Right",
      landmarks: landmarks.map(toLandmarkPoint),
    };

    if (category.categoryName === "Left") {
      if (!left || category.score > leftScore) {
        left = frame;
        leftScore = category.score;
      }
    } else if (category.categoryName === "Right") {
      if (!right || category.score > rightScore) {
        right = frame;
        rightScore = category.score;
      }
    }
  });

  return { left, right };
}

function extractUpperBodyPose(
  result: PoseLandmarks | null,
): PoseLandmarkFrame | null {
  const pose = result?.landmarks[0];
  if (!pose) return null;

  const frame = {} as PoseLandmarkFrame;
  for (const name of UPPER_BODY_POSE_LANDMARK_NAMES) {
    frame[name] = toLandmarkPoint(pose[UPPER_BODY_POSE_INDEX[name]]);
  }
  return frame;
}

export function buildFrameSample(
  timestamp: number,
  handResult: HandLandmarkerResult | null,
  poseResult: PoseLandmarks | null,
): LandmarkFrameSample {
  const hands = handResult && splitHandsByHandedness(handResult);
  return {
    timestamp,
    leftHand: hands?.left?.landmarks ?? null,
    rightHand: hands?.right?.landmarks ?? null,
    pose: extractUpperBodyPose(poseResult),
  };
}
