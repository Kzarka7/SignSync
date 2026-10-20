import { FilesetResolver, HandLandmarker, PoseLandmarker, type HandLandmarkerResult, type PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import { UPPER_BODY_POSE_LANDMARK_NAMES, type HandLandmarkFrame, type LandmarkFrameSample, type LandmarkPoint, type PoseLandmarkFrame, type UpperBodyPoseLandmarkName } from '../../types/landmarks'

// MediaPipe's hosted WASM runtime and models. Fetched by the browser at
// runtime, not bundled - no local model files to manage.
export const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// "Lite" variant - plenty of accuracy for the upper-body subset we keep
// (shoulders/elbows/wrists/hips), and noticeably cheaper per-frame than
// full/heavy, which matters since it now runs every tick alongside the
// hand model. Same hosting convention as HAND_MODEL_URL above.
export const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

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

export async function createHandLandmarker(
  fileset: VisionFileset,
  report: (delegate: string, fallback?: string) => void,
): Promise<HandLandmarker> {
  const options = {
    runningMode: "VIDEO" as const,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
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
  result: PoseLandmarkerResult | null,
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
  handResult: HandLandmarkerResult,
  poseResult: PoseLandmarkerResult | null,
): LandmarkFrameSample {
  const { left, right } = splitHandsByHandedness(handResult);
  return {
    timestamp,
    leftHand: left?.landmarks ?? null,
    rightHand: right?.landmarks ?? null,
    pose: extractUpperBodyPose(poseResult),
  };
}
