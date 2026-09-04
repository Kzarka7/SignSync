import { useEffect, useRef, useState, type RefObject } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  UPPER_BODY_POSE_LANDMARK_NAMES,
  type HandLandmarkFrame,
  type LandmarkFrameSample,
  type LandmarkPoint,
  type PoseLandmarkFrame,
  type UpperBodyPoseLandmarkName,
} from "../types/landmarks";

// MediaPipe's hosted WASM runtime and models. Fetched by the browser at
// runtime, not bundled - no local model files to manage.
const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
// "Lite" variant - plenty of accuracy for the upper-body subset we keep
// (shoulders/elbows/wrists/hips), and noticeably cheaper per-frame than
// full/heavy, which matters since it now runs every tick alongside the
// hand model. Same hosting convention as HAND_MODEL_URL above.
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

// Indices into PoseLandmarker's standard 33-point output for the
// upper-body subset we keep - see UPPER_BODY_POSE_LANDMARK_NAMES in
// ../types/landmarks for why the rest (face mesh, legs, feet) are dropped.
const UPPER_BODY_POSE_INDEX: Record<UpperBodyPoseLandmarkName, number> = {
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

const POSE_CONNECTIONS: [UpperBodyPoseLandmarkName, UpperBodyPoseLandmarkName][] = [
  ["leftShoulder", "rightShoulder"],
  ["leftShoulder", "leftElbow"],
  ["leftElbow", "leftWrist"],
  ["rightShoulder", "rightElbow"],
  ["rightElbow", "rightWrist"],
  ["leftShoulder", "leftHip"],
  ["rightShoulder", "rightHip"],
  ["leftHip", "rightHip"],
  ["nose", "leftShoulder"],
  ["nose", "rightShoulder"],
];

// Average frame brightness (0-255 scale) below this triggers the low-light
// warning. Tuned loosely - revisit once you've tested in an actual
// hospital/office lighting setting.
const LIGHT_WARNING_THRESHOLD = 70;

// Frames are downscaled to this tiny canvas before averaging brightness -
// reading full-resolution pixel data every frame would be wasteful.
const BRIGHTNESS_SAMPLE_SIZE = 32;

const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],

  // Index
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],

  // Middle
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],

  // Ring
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],

  // Pinky
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],

  // Palm
  [0, 17],
];

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

export interface CameraFeedState {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  cameraReady: boolean;
  handsDetected: boolean;
  // Whether PoseLandmarker is currently returning a pose (mirrors
  // handsDetected's meaning/semantics for the new model). Independent of
  // handsDetected since a signer can be in frame with their pose visible
  // but a hand briefly occluded, or vice versa.
  poseDetected: boolean;
  lightLevel: "ready" | "warning";
  error: string | null;
  modelError: string | null;
  enabled: boolean;
  toggleCamera: () => void;
  // Synchronized hand + pose landmarks from the most recently processed
  // frame, for anything downstream that wants to read a snapshot on
  // demand (e.g. a future dataset-recording "capture this frame" action).
  // Not reactive state on purpose - this changes every rAF tick, which
  // would mean a re-render per frame for every consumer whether or not
  // they read it; use the onFrame callback below if you need to react to
  // every frame instead.
  getLatestFrame: () => LandmarkFrameSample | null;
}

export interface UseCameraFeedOptions {
  // Fired once per detection tick with synchronized hand + pose landmarks
  // for that frame. This is the hook for a future dataset collector to
  // record samples from - left undefined today since nothing consumes it
  // yet, but the detection loop always produces the data either way.
  onFrame?: (sample: LandmarkFrameSample) => void;
}

// Owns the camera stream and the MediaPipe HandLandmarker + PoseLandmarker
// detection loop. Renders nothing itself - callers attach
// `videoRef`/`canvasRef` to their own <video>/<canvas> elements and read
// the derived state (hands detected, light level) to drive status pills
// elsewhere on the page.
//
// `autoStart` lets a caller begin detection immediately (e.g. Live
// Conversation, arriving from Session Setup where the user already
// confirmed device readiness and pressed "Begin Conversation") instead of
// requiring a further manual Start click.
export function useCameraFeed(options?: UseCameraFeedOptions): CameraFeedState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Persisted across start/stop toggles (not recreated every time) since
  // loading the MediaPipe models takes a second or two - only closed on
  // full component unmount, see the effect below.
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  // MediaPipe requires each call to detectForVideo() on a given landmarker
  // to use a strictly increasing timestamp. video.currentTime resets to 0
  // every time the camera is restarted, but the landmarker instances above
  // are intentionally kept alive across restarts - so feeding them
  // video.currentTime again after a stop/start sends a timestamp lower
  // than one they already saw, which throws and leaves detection broken
  // until a full page reload. performance.now() is relative to page load,
  // not the video, so it keeps climbing across restarts and sidesteps the
  // issue entirely. lastTimestampRef guards against the (rarer) case of
  // two rAF ticks resolving with an identical or out-of-order value. Both
  // landmarkers are fed the same timestamp each tick so their outputs stay
  // synchronized to the same video frame.
  const lastTimestampRef = useRef<number>(-1);
  // Latest synchronized sample, exposed via getLatestFrame() below.
  const latestFrameRef = useRef<LandmarkFrameSample | null>(null);
  // Keeps the onFrame callback identity out of the detection effect's
  // dependency array - it's read fresh each tick via this ref instead, so
  // callers can pass an inline function without tearing down and
  // restarting the camera/model setup on every render.
  const onFrameRef = useRef(options?.onFrame);
  onFrameRef.current = options?.onFrame;

  const [enabled, setEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [handsDetected, setHandsDetected] = useState(false);
  const [poseDetected, setPoseDetected] = useState(false);
  const [lightLevel, setLightLevel] = useState<"ready" | "warning">("ready");
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  const toggleCamera = () => setEnabled((prev) => !prev);
  const getLatestFrame = () => latestFrameRef.current;

  useEffect(() => {
    if (!enabled) {
      setCameraReady(false);
      setHandsDetected(false);
      setPoseDetected(false);
      setLightLevel("ready");
      setError(null);
      setModelError(null);
      latestFrameRef.current = null;
      return;
    }

    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let cancelled = false;

    async function setup() {
      setError(null);
      setModelError(null);

      // Camera acquisition only. If this fails, there's genuinely nothing
      // to show - hide the video and report it honestly.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720 },
        });
        if (cancelled) {
          // Effect was cleaned up (a fast Stop click, or leaving the page)
          // while this permission request was still in flight. Release
          // the stream immediately - leaving it open here is exactly what
          // caused "could not access the camera" on every attempt after
          // this one, since the browser saw the camera as still in use by
          // this leaked handle.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraReady(true);
      } catch (err) {
        // Release the stream if one was acquired before the failure (e.g.
        // video.play() rejected) - leaving it open here would lock the
        // camera for every subsequent attempt, even with nothing else
        // using it.
        stream?.getTracks().forEach((track) => track.stop());
        stream = null;
        if (videoRef.current) videoRef.current.srcObject = null;

        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Camera access was denied. Allow camera access in your browser to use live detection."
            : "Could not access the camera. Check that no other app is using it.",
        );
        return;
      }

      // Separate try/catch on purpose: a failure here means a detection
      // model didn't load (usually a network issue fetching it from
      // Google's hosted CDN) - it has nothing to do with camera access, so
      // it must not be reported as a camera error, and the video feed you
      // can already see should keep working even without detection
      // running.
      try {
        if (!landmarkerRef.current) {
          const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
          landmarkerRef.current = await HandLandmarker.createFromOptions(
            fileset,
            {
              baseOptions: { modelAssetPath: HAND_MODEL_URL },
              runningMode: "VIDEO",
              numHands: 2,
              minHandDetectionConfidence: 0.6,
              minHandPresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            },
          );

          // Pose is loaded in its own nested try/catch: if it fails (e.g.
          // this specific model file is unreachable while the hand model
          // loaded fine), hand detection - the pre-existing, required
          // functionality - must keep working. Pose landmarks simply stay
          // absent from every frame sample until a later reload succeeds.
          // Same fileset/WASM runtime as the hand model - only the model
          // asset differs.
          try {
            poseLandmarkerRef.current = await PoseLandmarker.createFromOptions(
              fileset,
              {
                baseOptions: { modelAssetPath: POSE_MODEL_URL },
                runningMode: "VIDEO",
                numPoses: 1,
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              },
            );
          } catch (poseErr) {
            console.error(
              "[useCameraFeed] Pose model loading error:",
              poseErr,
            );
          }
        }

        if (!sampleCanvasRef.current) {
          sampleCanvasRef.current = document.createElement("canvas");
          sampleCanvasRef.current.width = BRIGHTNESS_SAMPLE_SIZE;
          sampleCanvasRef.current.height = BRIGHTNESS_SAMPLE_SIZE;
        }

        detectLoop();
      } catch (err) {
        console.error("[useCameraFeed] Model loading error:", err);
        setModelError(
          "Hand detection isn't available right now (the detection model failed to load). Your camera is still working.",
        );
      }
    }

    function detectLoop() {
      if (cancelled || !videoRef.current || !landmarkerRef.current) return;

      const video = videoRef.current;
      if (video.readyState >= 2) {
        // Strictly increasing across the landmarkers' lifetime, even
        // across stop/start - see lastTimestampRef comment above. The same
        // timestamp is fed to both models so their results describe the
        // same instant.
        let timestamp = performance.now();
        if (timestamp <= lastTimestampRef.current) {
          timestamp = lastTimestampRef.current + 1;
        }
        lastTimestampRef.current = timestamp;

        const handResult: HandLandmarkerResult =
          landmarkerRef.current.detectForVideo(video, timestamp);
        const poseResult: PoseLandmarkerResult | null =
          poseLandmarkerRef.current?.detectForVideo(video, timestamp) ?? null;

        setHandsDetected(handResult.landmarks.length > 0);
        setPoseDetected(!!poseResult && poseResult.landmarks.length > 0);
        drawOverlay(handResult, poseResult);
        updateLightLevel(video);

        const sample = buildFrameSample(timestamp, handResult, poseResult);
        latestFrameRef.current = sample;
        onFrameRef.current?.(sample);
      }

      rafId = requestAnimationFrame(detectLoop);
    }

    // Reduces one HandLandmarker detection into the left/right hand shape
    // the rest of the app (and the eventual dataset) expects, using the
    // per-hand handedness category MediaPipe returns alongside landmarks.
    // If two hands report the same side (rare misclassification), the
    // higher-confidence one wins and the other is dropped rather than
    // silently overwritten.
    function splitHandsByHandedness(
      result: HandLandmarkerResult,
    ): { left: HandLandmarkFrame | null; right: HandLandmarkFrame | null } {
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

    function buildFrameSample(
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

    // Draws small dots over each detected hand landmark, plus a skeleton
    // over the upper-body pose points, onto the overlay canvas - positioned
    // to exactly match the underlying video element.
    function drawOverlay(
      handResult: HandLandmarkerResult,
      poseResult: PoseLandmarkerResult | null,
    ) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.imageSmoothingEnabled = true;

      const pose = poseResult?.landmarks[0];
      if (pose) {
        ctx.strokeStyle = "#00D9FF";
        ctx.lineWidth = 3;

        for (const [startName, endName] of POSE_CONNECTIONS) {
          const p1 = pose[UPPER_BODY_POSE_INDEX[startName]];
          const p2 = pose[UPPER_BODY_POSE_INDEX[endName]];
          if (!p1 || !p2) continue;

          ctx.beginPath();
          ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
          ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
          ctx.stroke();
        }

        for (const name of UPPER_BODY_POSE_LANDMARK_NAMES) {
          const point = pose[UPPER_BODY_POSE_INDEX[name]];
          if (!point) continue;
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;

          ctx.beginPath();
          ctx.arc(x, y, 6, 0, Math.PI * 2);
          ctx.fillStyle = "#00D9FF";
          ctx.fill();
        }
      }

      for (const hand of handResult.landmarks) {
        ctx.strokeStyle = "#00FF00";
        ctx.lineWidth = 3;

        for (const [start, end] of HAND_CONNECTIONS) {
          const p1 = hand[start];
          const p2 = hand[end];

          ctx.beginPath();
          ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
          ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
          ctx.stroke();
        }

        for (const point of hand) {
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;

          // Green outer circle
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = "#00FF00";
          ctx.fill();

          // Red inner circle
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fillStyle = "#FF0000";
          ctx.fill();
        }
      }
    }

    function updateLightLevel(video: HTMLVideoElement) {
      const sampleCanvas = sampleCanvasRef.current;
      if (!sampleCanvas) return;
      const ctx = sampleCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(
        video,
        0,
        0,
        BRIGHTNESS_SAMPLE_SIZE,
        BRIGHTNESS_SAMPLE_SIZE,
      );
      const { data } = ctx.getImageData(
        0,
        0,
        BRIGHTNESS_SAMPLE_SIZE,
        BRIGHTNESS_SAMPLE_SIZE,
      );

      let total = 0;
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      const avgBrightness = total / (data.length / 4);
      setLightLevel(
        avgBrightness < LIGHT_WARNING_THRESHOLD ? "warning" : "ready",
      );
    }

    setup();

    // Runs when `enabled` flips back to false, or the component unmounts.
    // Stops the stream and the detection loop, but deliberately does NOT
    // close landmarkerRef - see the dedicated unmount-only effect below.
    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [enabled]);

  // Full-unmount-only cleanup: release both MediaPipe models.
  useEffect(() => {
    return () => {
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      poseLandmarkerRef.current?.close();
      poseLandmarkerRef.current = null;
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    cameraReady,
    handsDetected,
    poseDetected,
    lightLevel,
    error,
    modelError,
    enabled,
    toggleCamera,
    getLatestFrame,
  };
}
