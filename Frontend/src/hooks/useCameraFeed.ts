import {
  WASM_BASE_URL, UPPER_BODY_POSE_INDEX, createHandLandmarker, createPoseLandmarker,
  buildFrameSample, smoothPoseShoulders, HAND_LANDMARKER_THRESHOLDS,
  type HandDelegatePreference, type PoseLandmarks,
} from '../services/landmarks/visionRuntime';
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createCameraProfile, createRecentCameraTiming, type DetectionTiming } from "../services/cameraProfile";
import { createDetectionInput, type DetectionInputWidth } from "../services/detectionInput";
import { HAND_OVERLAY_COLORS } from "../services/landmarks/handOverlayColors";
import { createStreamingHandAssignment } from "../services/dataset/videoHandAssignment";
import { createLowLightAssist } from "../services/landmarks/lowLightAssist";
import { createHandCapacityController, type HandCapacity } from "../services/landmarks/handCapacity";
import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  UPPER_BODY_POSE_LANDMARK_NAMES,
  type LandmarkFrameSample,
  type LandmarkPoint,
  type UpperBodyPoseLandmarkName,
} from "../types/landmarks";

const POSE_CONNECTIONS: [
  UpperBodyPoseLandmarkName,
  UpperBodyPoseLandmarkName,
][] = [
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
  // True while the detectors receive a brightened copy of dark frames.
  lowLightAssistActive: boolean;
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
  startPerformanceProfile: () => void;
  stopPerformanceProfile: () => void;
  getPerformanceReport: () => string;
  startLandmarkBenchmark: () => void;
  stopLandmarkBenchmark: () => string;
  getLiveTiming: () => LiveCameraTiming | null;
}

export type LiveCameraTiming = NonNullable<ReturnType<ReturnType<typeof createRecentCameraTiming>['snapshot']>> & {
  handDelegate: string | null;
  poseDelegate: string | null;
  inputWidth?: number;
  inputHeight?: number;
  // Exposure lift applied to the detection input (1 means unchanged).
  lowLightGain: number;
};

export type LandmarkMode = "hands" | "pose" | "both";
const PAIRED_POSE_STRIDE = 4;
const POSE_CACHE_MAX_AGE_MS = 350;
const HAND_OVERLAY_HOLD_MS = 150;
// A held overlay hand follows its last measured palm motion for at most
// this long, so a short dropout during fast motion does not leave a frozen
// skeleton behind the moving hand. Display only.
const HAND_OVERLAY_EXTRAPOLATE_MS = 80;
const HAND_OVERLAY_PALM_JOINTS = [0, 5, 9, 13, 17] as const;
// Normalized frame units; keeps one noisy step from throwing the overlay.
const HAND_OVERLAY_MAX_SHIFT = 0.12;

// "fast" asks for 640x360, which many laptop webcams deliver at a full
// 30 fps when 720p is limited to 15-20 fps. Detection then needs no resize.
export type CaptureProfile = "720p" | "fast";
const CAPTURE_CONSTRAINTS: Record<CaptureProfile, MediaTrackConstraints> = {
  "720p": { width: 1280, height: 720, frameRate: { ideal: 30 } },
  fast: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
};

export interface UseCameraFeedOptions {
  detectionInputWidth?: DetectionInputWidth;
  landmarkMode?: LandmarkMode;
  trackLiveTiming?: boolean;
  trackOverlayPaint?: boolean;
  decoupleVideoFrames?: boolean;
  stridePairedPose?: boolean;
  showHandLandmarks?: boolean;
  showPoseLandmarks?: boolean;
  reviewHandTracking?: boolean;
  // Brightens dark hand regions in the detection input only. On by default;
  // it leaves frames unchanged unless the hands or wrists are dark.
  lowLightAssist?: boolean;
  // Processor for the hand model. GPU falls back to CPU when unavailable.
  handDelegate?: HandDelegatePreference;
  captureProfile?: CaptureProfile;
  // Palm detector threshold. The palm detector re-finds a hand each frame
  // while fewer than two hands are tracked; curled fingers and motion blur
  // score lower than open palms. The landmark model's presence check (0.5)
  // still rejects crops without a hand.
  handDetectionConfidence?: number;
  // With paired pose striding, run pose after the frame's hand landmarks are
  // delivered instead of before. Hands no longer wait for pose; the pose in
  // each sample is the cached one, at most one processed frame older than
  // in the default order.
  deferPose?: boolean;
  // While exactly one hand is tracked, run a one-hand landmarker that skips
  // the per-frame search for a second hand, with a two-hand search every few
  // frames. See services/landmarks/handCapacity.
  adaptiveHandCapacity?: boolean;
  // Delivers every processed frame, including cached pose when striding is enabled.
  onFrame?: (sample: LandmarkFrameSample) => void;
}

// Default capture size for Recognition Lab and the Dataset Collector.
export const DEFAULT_LIVE_CAPTURE_PROFILE: CaptureProfile = "720p";

// Palm detector threshold for live camera tracking; re-finds hands sooner
// after fast motion or curled fingers. See handDetectionConfidence.
export const LIVE_HAND_DETECTION_CONFIDENCE = 0.35;

// Shared by Recognition Lab and the Dataset Collector so collected samples
// come from the same detection schedule and thresholds recognition uses.
export const OPTIMIZED_LIVE_CAMERA_OPTIONS = {
  decoupleVideoFrames: true,
  stridePairedPose: true,
  reviewHandTracking: true,
  // Hands are delivered without waiting for the pose model.
  deferPose: true,
  handDetectionConfidence: LIVE_HAND_DETECTION_CONFIDENCE,
} as const satisfies UseCameraFeedOptions;

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
  const profileRef = useRef(createCameraProfile());
  const benchmarkRef = useRef(createCameraProfile());
  const recentTimingRef = useRef(createRecentCameraTiming());
  const trackLiveTiming = options?.trackLiveTiming ?? false;
  const trackOverlayPaint = options?.trackOverlayPaint ?? false;
  const decoupleVideoFrames = options?.decoupleVideoFrames ?? false;
  const landmarkMode = options?.landmarkMode ?? "both";
  const useHands = landmarkMode !== "pose";
  const usePose = landmarkMode !== "hands";
  const poseStride = options?.stridePairedPose && useHands && usePose ? PAIRED_POSE_STRIDE : 1;
  const requestedHandDelegate = options?.handDelegate ?? "GPU";
  const captureProfile = options?.captureProfile ?? "720p";
  const handDetectionConfidence = options?.handDetectionConfidence ?? HAND_LANDMARKER_THRESHOLDS.minHandDetectionConfidence;
  const deferPose = (options?.deferPose ?? false) && poseStride > 1;
  const adaptiveHandCapacity = (options?.adaptiveHandCapacity ?? false) && useHands;
  const profileInfoRef = useRef({
    capture: {} as { width?: number; height?: number; configuredFps?: number },
    detectionInput: {} as { width?: number; height?: number; mode?: string },
    landmarkMode, poseStride, handDelegate: "not initialized", poseDelegate: "not initialized",
    requestedHandDelegate: requestedHandDelegate as string, captureProfile: captureProfile as string,
    handThresholds: { ...HAND_LANDMARKER_THRESHOLDS, minHandDetectionConfidence: handDetectionConfidence } as Record<string, number>,
    poseScheduling: (deferPose ? "after hand landmarks" : "with hands") as string,
    dynamicHandCapacity: false,
    handFallback: "", poseFallback: "", scheduling: "not started", inferenceThread: "main",
    lowLightAssist: "adaptive" as "adaptive" | "off", lowLightAssistFrames: 0, lowLightMaxGain: 1,
    lowLightMethod: "not used" as string,
    // What the camera reports about exposure, so a camera that slows its
    // frame rate in dim light can be identified from a benchmark.
    cameraExposure: null as Record<string, unknown> | null,
  });
  const recordedProfileInfoRef = useRef<typeof profileInfoRef.current | null>(null);
  const benchmarkInfoRef = useRef<typeof profileInfoRef.current | null>(null);
  const reportMode = useCallback((info: typeof profileInfoRef.current) => ({
    ...info,
    ...(info.landmarkMode === "pose" && { handDelegate: "disabled", handFallback: "" }),
    ...(info.landmarkMode === "hands" && { poseDelegate: "disabled", poseFallback: "" }),
  }), []);
  const startPerformanceProfile = useCallback(() => {
    recordedProfileInfoRef.current = null;
    profileRef.current.start();
  }, []);
  const stopPerformanceProfile = useCallback(() => profileRef.current.stop(), []);
  const startLandmarkBenchmark = useCallback(() => {
    benchmarkInfoRef.current = null;
    benchmarkRef.current.start(true);
  }, []);
  const stopLandmarkBenchmark = useCallback(() => {
    benchmarkRef.current.stop();
    const info = reportMode(benchmarkInfoRef.current ?? profileInfoRef.current);
    return JSON.stringify({
      format: "signsync-landmark-benchmark",
      version: 1,
      ...info,
      overlay: {
        hands: info.landmarkMode !== "pose" && overlayOptionsRef.current.hands,
        pose: info.landmarkMode !== "hands" && overlayOptionsRef.current.pose,
      },
      ...benchmarkRef.current.snapshot(),
      notes: [
        "Fresh hand FPS counts distinct video timestamps with at least one detected hand.",
        "Latency starts at the video callback. Overlay paint opportunity is estimated with animation callbacks.",
        "Compare foreground-only runs with matched delegates and actual capture settings.",
        ...(info.poseScheduling === "after hand landmarks" ? [
          "Pose ran after each frame's hand landmarks were delivered. poseMs is attributed to the next frame and is not part of totalMs or callbackToLandmarksMs.",
        ] : []),
      ],
    });
  }, [reportMode]);
  const getPerformanceReport = useCallback(() => JSON.stringify({
    version: 2,
    ...reportMode(recordedProfileInfoRef.current ?? profileInfoRef.current),
    ...profileRef.current.snapshot(),
    notes: [
      "Timings are wall-clock API-call durations, not GPU utilization or GPU-only execution times.",
      "GPU means the GPU delegate initialized; this does not identify the physical adapter or rule out software rendering.",
      "Configured FPS is a track setting. Browser-presented FPS is compositor cadence, not proof of distinct phone images or camera delivery rate.",
      "Processing totals exclude waiting between callbacks and deferred painting.",
      "Hidden-tab runs are not comparable.",
    ],
  }, null, 2), [reportMode]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Persisted across start/stop toggles (not recreated every time) since
  // loading the MediaPipe models takes a second or two - only closed on
  // full component unmount, see the effect below.
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  // Delegate the live hand landmarker was created for, so a change recreates it.
  const landmarkerPreferenceRef = useRef<string | null>(null);
  // One-hand landmarker for adaptiveHandCapacity, kept alive like the others.
  const singleLandmarkerRef = useRef<HandLandmarker | null>(null);
  const singleLandmarkerPreferenceRef = useRef<string | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const getLiveTiming = useCallback(() => {
    const timing = recentTimingRef.current.snapshot(performance.now());
    return timing && { ...timing,
      handDelegate: useHands && landmarkerRef.current ? profileInfoRef.current.handDelegate : null,
      poseDelegate: usePose && poseLandmarkerRef.current ? profileInfoRef.current.poseDelegate : null,
      inputWidth: profileInfoRef.current.detectionInput.width, inputHeight: profileInfoRef.current.detectionInput.height,
      lowLightGain: lowLightGainRef.current };
  }, [useHands, usePose]);
  // MediaPipe requires each call to detectForVideo() on a given landmarker
  // to use a strictly increasing timestamp. video.currentTime resets to 0
  // every time the camera is restarted, but the landmarker instances above
  // are intentionally kept alive across restarts - so feeding them
  // video.currentTime again after a stop/start sends a timestamp lower
  // than one they already saw, which throws and leaves detection broken
  // until a full page reload. performance.now() is relative to page load,
  // not the video, so it keeps climbing across restarts and sidesteps the
  // issue entirely. lastTimestampRef guards against identical or out-of-order
  // callbacks. Both landmarkers receive the same timestamp so their outputs stay
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
  const overlayOptionsRef = useRef({ hands: true, pose: true });
  overlayOptionsRef.current.hands = useHands && (options?.showHandLandmarks ?? true);
  overlayOptionsRef.current.pose = usePose && (options?.showPoseLandmarks ?? true);
  const reviewHandTracking = options?.reviewHandTracking ?? false;
  const detectionInputWidthRef = useRef(options?.detectionInputWidth ?? null);
  detectionInputWidthRef.current = options?.detectionInputWidth ?? null;
  const prepareDetectionInputRef = useRef(createDetectionInput());
  const lowLightAssist = options?.lowLightAssist ?? true;
  const lowLightGainRef = useRef(1);

  const [enabled, setEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [handsDetected, setHandsDetected] = useState(false);
  const [poseDetected, setPoseDetected] = useState(false);
  const [lightLevel, setLightLevel] = useState<"ready" | "warning">("ready");
  const [lowLightAssistActive, setLowLightAssistActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  const toggleCamera = () => setEnabled((prev) => !prev);
  const getLatestFrame = () => latestFrameRef.current;

  useEffect(() => {
    if (!enabled) {
      recentTimingRef.current.clear();
      setCameraReady(false);
      setHandsDetected(false);
      setPoseDetected(false);
      setLightLevel("ready");
      setLowLightAssistActive(false);
      lowLightGainRef.current = 1;
      setError(null);
      setModelError(null);
      latestFrameRef.current = null;
      return;
    }

    let stream: MediaStream | null = null;
    let rafId: number | null = null;
    let videoFrameId: number | null = null;
    let videoFrameSource: HTMLVideoElement | null = null;
    let inferenceTask: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let lastLightSample = 0;
    let useBitmapFrames = decoupleVideoFrames && typeof createImageBitmap === "function";
    let capturingFrame = false;
    let lastCapturedMediaTime = -Infinity;
    let processedFrameIndex = 0;
    let cachedPose: PoseLandmarks | null = null;
    let cachedPoseAt = -Infinity;
    const lastRenderedHands: [LandmarkPoint[] | null, LandmarkPoint[] | null] = [null, null];
    const lastRenderedHandsAt = [-Infinity, -Infinity];
    // Palm-centre velocity per slot, normalized units per millisecond.
    const renderedHandMotion: ({ x: number; y: number } | null)[] = [null, null];
    let latestVideoFrame: {
      bitmap: ImageBitmap;
      metadata: VideoFrameCallbackMetadata;
      observedAt: number;
      hidden: boolean;
      copyMs: number;
    } | null = null;
    const assignHands = reviewHandTracking ? createStreamingHandAssignment() : null;
    const capacityController = adaptiveHandCapacity ? createHandCapacityController() : null;
    profileInfoRef.current.dynamicHandCapacity = false;
    const lowLight = lowLightAssist && useHands ? createLowLightAssist() : null;
    let lowLightActive = false;
    lowLightGainRef.current = 1;
    profileInfoRef.current.lowLightAssist = lowLight ? "adaptive" : "off";
    profileInfoRef.current.lowLightAssistFrames = 0;
    profileInfoRef.current.lowLightMaxGain = 1;
    profileInfoRef.current.lowLightMethod = "not used";
    profileInfoRef.current.cameraExposure = null;
    type FrameTiming = {
      started: number;
      observedAt: number;
      copyMs?: number;
      aspectRatio: number;
      timestamp: number;
      resizeMs: number;
      mediaTime: number;
      presentedFrames?: number;
      hidden: boolean;
      handCapacity?: HandCapacity;
    };
    profileInfoRef.current.landmarkMode = landmarkMode;
    profileInfoRef.current.poseStride = poseStride;
    profileInfoRef.current.requestedHandDelegate = requestedHandDelegate;
    profileInfoRef.current.captureProfile = captureProfile;
    profileInfoRef.current.handThresholds = { ...HAND_LANDMARKER_THRESHOLDS, minHandDetectionConfidence: handDetectionConfidence };
    profileInfoRef.current.poseScheduling = deferPose ? "after hand landmarks" : "with hands";
    const landmarkerKey = requestedHandDelegate + ":" + handDetectionConfidence;
    // Deferred pose: the job runs in its own task once the hand landmarks
    // are out, or first thing in the next frame, before that frame reuses
    // the detection input canvases.
    let pendingPose: { run: () => void; release: () => void } | null = null;
    let poseTask: ReturnType<typeof setTimeout> | null = null;
    let poseFreshForNextFrame = false;
    let carriedPoseMs = 0;

    async function setup() {
      setCameraReady(false);
      setHandsDetected(false);
      setPoseDetected(false);
      latestFrameRef.current = null;
      setError(null);
      setModelError(null);

      // Camera acquisition only. If this fails, there's genuinely nothing
      // to show - hide the video and report it honestly.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // Actual settings depend on the camera; they are reported below.
          video: CAPTURE_CONSTRAINTS[captureProfile],
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

        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        profileInfoRef.current.capture = { width: settings?.width, height: settings?.height, configuredFps: settings?.frameRate };
        profileInfoRef.current.cameraExposure = readCameraExposure(track);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (cancelled) return;
        setCameraReady(true);
      } catch (err) {
        if (cancelled) return;
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
        if (!sampleCanvasRef.current) {
          sampleCanvasRef.current = document.createElement("canvas");
          sampleCanvasRef.current.width = BRIGHTNESS_SAMPLE_SIZE;
          sampleCanvasRef.current.height = BRIGHTNESS_SAMPLE_SIZE;
        }


        if (useHands && landmarkerRef.current && landmarkerPreferenceRef.current !== landmarkerKey) {
          landmarkerRef.current.close();
          landmarkerRef.current = null;
        }
        if (singleLandmarkerRef.current && (!adaptiveHandCapacity || singleLandmarkerPreferenceRef.current !== landmarkerKey)) {
          singleLandmarkerRef.current.close();
          singleLandmarkerRef.current = null;
        }
        const needsHands = useHands && !landmarkerRef.current;
        const needsPose = usePose && !poseLandmarkerRef.current;
        const needsSingleHand = adaptiveHandCapacity && !singleLandmarkerRef.current;
        if (needsHands || needsPose || needsSingleHand) {
          const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
          if (cancelled) return;
          if (needsHands) {
            const hands = await createHandLandmarker(fileset, (delegate, fallback = "") => {
              if (cancelled) return;
              profileInfoRef.current.handDelegate = delegate;
              profileInfoRef.current.handFallback = fallback;
            }, requestedHandDelegate, handDetectionConfidence);
            if (cancelled) { hands.close(); return; }
            landmarkerRef.current = hands;
            landmarkerPreferenceRef.current = landmarkerKey;
          }
          if (needsSingleHand) {
            // Optional: without it the two-hand model handles every frame.
            try {
              const single = await createHandLandmarker(fileset, () => {}, requestedHandDelegate, handDetectionConfidence, 1);
              if (cancelled) { single.close(); return; }
              singleLandmarkerRef.current = single;
              singleLandmarkerPreferenceRef.current = landmarkerKey;
            } catch (singleErr) {
              if (cancelled) return;
              console.warn("[useCameraFeed] One-hand landmarker unavailable; using two-hand tracking only:", singleErr);
            }
          }
          if (needsPose) {
            try {
              const pose = await createPoseLandmarker(fileset, (delegate, fallback = "") => {
                if (cancelled) return;
                profileInfoRef.current.poseDelegate = delegate;
                profileInfoRef.current.poseFallback = fallback;
              });
              if (cancelled) { pose.close(); return; }
              poseLandmarkerRef.current = pose;
            } catch (poseErr) {
              // Both mode can still track hands when pose fails to load.
              if (cancelled) return;
              profileInfoRef.current.poseDelegate = "unavailable";
              if (!useHands) throw poseErr;
              console.error("[useCameraFeed] Pose model loading error:", poseErr);
            }
          }
        }

        if (cancelled) return;
        profileInfoRef.current.dynamicHandCapacity = !!capacityController && !!singleLandmarkerRef.current;
        scheduleNextFrame();
      } catch (err) {
        if (cancelled) return;
        console.error("[useCameraFeed] Model loading error:", err);
        if (useHands) profileInfoRef.current.handDelegate = "unavailable";
        else profileInfoRef.current.poseDelegate = "unavailable";
        setModelError(
          `${useHands ? "Hand" : "Pose"} detection isn't available right now (the detection model failed to load). Your camera is still working.`,
        );
      }
    }

    function scheduleNextFrame() {
      const video = videoRef.current;
      if (cancelled || !video) return;
      if (typeof video.requestVideoFrameCallback === "function") {
        profileInfoRef.current.scheduling = useBitmapFrames
          ? "requestVideoFrameCallback (latest frame)" : "requestVideoFrameCallback";
        videoFrameSource = video;
        videoFrameId = video.requestVideoFrameCallback(useBitmapFrames ? captureVideoFrame : detectLoop);
      } else {
        profileInfoRef.current.scheduling = "requestAnimationFrame (compositor cadence unavailable)";
        rafId = requestAnimationFrame(detectLoop);
      }
    }

    function discardPendingVideoFrame() {
      if (inferenceTask !== null) clearTimeout(inferenceTask);
      inferenceTask = null;
      latestVideoFrame?.bitmap.close();
      latestVideoFrame = null;
    }

    function captureVideoFrame(_now: number, metadata: VideoFrameCallbackMetadata) {
      const video = videoRef.current;
      if (cancelled || !video) return;
      scheduleNextFrame();
      if (video.readyState < 2 || capturingFrame || metadata.mediaTime <= lastCapturedMediaTime) return;

      const observedAt = performance.now();
      const hidden = document.hidden;
      lastCapturedMediaTime = metadata.mediaTime;
      capturingFrame = true;
      void createImageBitmap(video).then(bitmap => {
        capturingFrame = false;
        if (cancelled) {
          bitmap.close();
          return;
        }
        latestVideoFrame?.bitmap.close();
        latestVideoFrame = { bitmap, metadata, observedAt, hidden, copyMs: performance.now() - observedAt };
        inferenceTask ??= setTimeout(processLatestVideoFrame, 0);
      }, () => {
        capturingFrame = false;
        if (cancelled) return;
        // Continue with the direct video path if this browser cannot copy the stream.
        useBitmapFrames = false;
        discardPendingVideoFrame();
        if (videoFrameId !== null) video.cancelVideoFrameCallback(videoFrameId);
        scheduleNextFrame();
      });
    }

    function stopTracking(err: unknown) {
      cancelled = true;
      if (videoFrameId !== null) videoFrameSource?.cancelVideoFrameCallback(videoFrameId);
      discardPendingPose();
      console.error("[useCameraFeed] Landmark tracking error:", err);
      setModelError("Landmark tracking stopped. Restart the camera to try again.");
    }

    function processLatestVideoFrame() {
      inferenceTask = null;
      const pending = latestVideoFrame;
      latestVideoFrame = null;
      if (!pending) return;
      let deferred: (() => void) | null = null;
      try {
        if (!cancelled) deferred = detectFrame(pending.bitmap, pending.observedAt, pending.metadata.mediaTime,
          pending.hidden, pending.metadata.presentedFrames, pending.copyMs);
      } catch (err) {
        stopTracking(err);
      } finally {
        if (deferred && !cancelled) schedulePose(deferred, () => pending.bitmap.close());
        else pending.bitmap.close();
      }
    }

    function schedulePose(run: () => void, release: () => void) {
      pendingPose = { run, release };
      poseTask = setTimeout(() => {
        try { runPendingPose(); } catch (err) { stopTracking(err); }
      }, 0);
    }

    function runPendingPose() {
      if (poseTask !== null) clearTimeout(poseTask);
      poseTask = null;
      const job = pendingPose;
      pendingPose = null;
      if (!job) return;
      try {
        if (!cancelled) job.run();
      } finally {
        job.release();
      }
    }

    function discardPendingPose() {
      if (poseTask !== null) clearTimeout(poseTask);
      poseTask = null;
      pendingPose?.release();
      pendingPose = null;
    }

    function detectLoop(_now: number, metadata?: VideoFrameCallbackMetadata) {
      const video = videoRef.current;
      if (cancelled || !video) return;
      if (video.readyState >= 2) {
        const timestamp = Math.max(performance.now(), lastTimestampRef.current + 1);
        const deferred = detectFrame(video, timestamp, metadata?.mediaTime ?? video.currentTime, document.hidden, metadata?.presentedFrames);
        if (deferred) schedulePose(deferred, () => {});
      }
      scheduleNextFrame();
    }

    function detectFrame(source: HTMLVideoElement | ImageBitmap, timestamp: number, mediaTime: number,
      hidden: boolean, presentedFrames?: number, copyMs?: number): (() => void) | null {
      if (timestamp <= lastTimestampRef.current) return null;
      // A deferred pose still reads the previous frame's detection input.
      runPendingPose();
      lastTimestampRef.current = timestamp;
      const started = performance.now();
      const sourceWidth = "videoWidth" in source ? source.videoWidth : source.width;
      const sourceHeight = "videoHeight" in source ? source.videoHeight : source.height;
      const input = prepareDetectionInputRef.current(source, detectionInputWidthRef.current);
      // Both models see the same (possibly brightened) frame. Its size and
      // normalized coordinates match `input`, so the reported input mode,
      // overlay and landmarks are unaffected.
      const detectionInput = lowLight ? lowLight.apply(input, latestFrameRef.current, timestamp) : input;
      const resizeMs = performance.now() - started;
      const gain = lowLight?.gain() ?? 1;
      lowLightGainRef.current = gain;
      if (gain > 1) {
        profileInfoRef.current.lowLightAssistFrames++;
        profileInfoRef.current.lowLightMaxGain = Math.max(profileInfoRef.current.lowLightMaxGain, Number(gain.toFixed(2)));
        profileInfoRef.current.lowLightMethod = lowLight!.method();
      }
      if ((gain > 1) !== lowLightActive) {
        lowLightActive = gain > 1;
        setLowLightAssistActive(lowLightActive);
      }
      const width = "videoWidth" in input ? input.videoWidth : input.width;
      const height = "videoHeight" in input ? input.videoHeight : input.height;
      const mode = input === source ? "original" : "reduced";
      const previousInput = profileInfoRef.current.detectionInput;
      if (width !== previousInput.width || height !== previousInput.height || mode !== previousInput.mode) {
        recentTimingRef.current.clear();
        profileInfoRef.current.detectionInput = { width, height, mode };
        processedFrameIndex = 0;
        cachedPose = null;
        capacityController?.reset();
      }
      const frame: FrameTiming = {
        started, observedAt: copyMs === undefined ? started : timestamp, timestamp, resizeMs,
        mediaTime, presentedFrames, hidden, copyMs, aspectRatio: sourceWidth / sourceHeight,
      };
      const runPose = usePose && processedFrameIndex++ % poseStride === 0;
      const stridedPose = poseStride > 1;
      if (stridedPose && timestamp - cachedPoseAt > POSE_CACHE_MAX_AGE_MS) cachedPose = null;
      const handStart = performance.now();
      const handResult = useHands ? detectHands(detectionInput, timestamp, frame) : null;
      const handEnd = performance.now();
      if (deferPose) {
        const poseFresh = poseFreshForNextFrame;
        const poseMs = carriedPoseMs;
        poseFreshForNextFrame = false;
        carriedPoseMs = 0;
        completeFrame(frame, handResult, cachedPose, poseFresh, handResult ? handEnd - handStart : 0, poseMs, true);
        if (!runPose) return null;
        return () => {
          const deferred = detectPose(detectionInput, timestamp);
          cachedPose = smoothPoseShoulders(cachedPose, deferred.result);
          cachedPoseAt = timestamp;
          carriedPoseMs = deferred.ms;
          poseFreshForNextFrame = !!deferred.result;
        };
      }
      const poseDetection = runPose ? detectPose(detectionInput, timestamp) : null;
      const freshPose = poseDetection?.result ?? null;
      if (stridedPose && runPose) {
        cachedPose = smoothPoseShoulders(cachedPose, freshPose);
        cachedPoseAt = timestamp;
      }
      completeFrame(frame, handResult, stridedPose ? cachedPose : freshPose, !!freshPose,
        handResult ? handEnd - handStart : 0, poseDetection?.ms ?? 0);
      return null;
    }

    function detectHands(input: TexImageSource, timestamp: number, frame: FrameTiming): HandLandmarkerResult | null {
      let capacity: HandCapacity = capacityController && singleLandmarkerRef.current ? capacityController.next() : 2;
      let result: HandLandmarkerResult | null = null;
      if (capacity === 1) {
        try {
          result = singleLandmarkerRef.current!.detectForVideo(input, timestamp);
        } catch (err) {
          // Keep tracking with the two-hand model for the rest of this run.
          console.warn("[useCameraFeed] One-hand landmarker failed; using two-hand tracking only:", err);
          singleLandmarkerRef.current?.close();
          singleLandmarkerRef.current = null;
          capacityController?.reset();
          profileInfoRef.current.dynamicHandCapacity = false;
          capacity = 2;
        }
      }
      if (capacity === 2) result = landmarkerRef.current?.detectForVideo(input, timestamp) ?? null;
      if (result) capacityController?.observe(capacity, result.landmarks.length);
      frame.handCapacity = capacity;
      return result;
    }

    function detectPose(input: TexImageSource, timestamp: number) {
      const start = performance.now();
      const result = poseLandmarkerRef.current?.detectForVideo(input, timestamp) ?? null;
      return { result, ms: result ? performance.now() - start : 0 };
    }

    function completeFrame(
      frame: FrameTiming,
      handResult: HandLandmarkerResult | null,
      poseResult: PoseLandmarks | null,
      hasFreshPose: boolean,
      handMs: number,
      poseMs: number,
      // Deferred pose ran before this frame started; it is reported but not in totalMs.
      poseOutsideTotal = false,
    ) {
      const video = videoRef.current;
      if (!video) return;
      // With striding, the pose in this sample is cached from the frame it ran
      // on; its age lets the assignment use it on every frame, with less weight.
      const poseAge = poseStride > 1 && Number.isFinite(cachedPoseAt) ? Math.max(0, frame.timestamp - cachedPoseAt) : hasFreshPose;
      const sample = assignHands
        ? assignHands(buildFrameSample(frame.timestamp, null, poseResult), handResult, frame.aspectRatio, poseAge)
        : buildFrameSample(frame.timestamp, handResult, poseResult);
      const handCount = assignHands ? Number(!!sample.leftHand) + Number(!!sample.rightHand) : handResult?.landmarks.length ?? 0;
      const handsDetected = handCount > 0;
      setHandsDetected(handsDetected);
      setPoseDetected(!!poseResult?.landmarks.length);
      const overlayStart = performance.now();
      drawOverlay(handResult, poseResult, overlayStart, assignHands ? sample : undefined);
      const overlayEnd = performance.now();
      if (frame.timestamp - lastLightSample >= 500) {
        updateLightLevel(video);
        lastLightSample = frame.timestamp;
      }

      latestFrameRef.current = sample;
      onFrameRef.current?.(sample);
      const completedAt = performance.now();
      const overlayMs = overlayEnd - overlayStart;
      const totalMs = completedAt - frame.started;
      if (profileRef.current.isActive() && !recordedProfileInfoRef.current) {
        recordedProfileInfoRef.current = { ...profileInfoRef.current, capture: { ...profileInfoRef.current.capture } };
      }
      if (benchmarkRef.current.isActive() && !benchmarkInfoRef.current) {
        benchmarkInfoRef.current = { ...profileInfoRef.current, capture: { ...profileInfoRef.current.capture } };
      }
      const timing: DetectionTiming = {
        handMs, poseMs, overlayMs, resizeMs: frame.resizeMs, totalMs, completedAt,
        otherMs: totalMs - handMs - (poseOutsideTotal ? 0 : poseMs) - overlayMs - frame.resizeMs,
        presentedFrames: frame.presentedFrames,
        frameCopyMs: frame.copyMs,
        callbackToLandmarksMs: completedAt - frame.observedAt,
        hidden: frame.hidden || document.hidden,
        mediaTime: frame.mediaTime, handsDetected,
        handCount,
        handCapacity: useHands && landmarkerRef.current ? frame.handCapacity ?? 2 : undefined,
        singleHandSide: handCount === 1
          ? assignHands ? (sample.leftHand ? "Right" : "Left") : displayHandSide(handResult?.handedness?.[0]?.[0]?.categoryName)
          : undefined,
      };
      profileRef.current.add(timing);
      benchmarkRef.current.add(timing);
      if (trackLiveTiming) recentTimingRef.current.add(timing);
      if ((trackOverlayPaint || benchmarkRef.current.isActive()) && !timing.hidden && (overlayOptionsRef.current.hands || overlayOptionsRef.current.pose)) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!cancelled && !document.hidden) timing.overlayPaintOpportunityMs = performance.now() - frame.observedAt;
        }));
      }
    }

    // Draws small dots over each detected hand landmark, plus a skeleton
    // over the upper-body pose points, onto the overlay canvas - positioned
    // to exactly match the underlying video element.
    function drawOverlay(
      handResult: HandLandmarkerResult | null,
      poseResult: PoseLandmarks | null,
      renderedAt: number,
      assigned?: LandmarkFrameSample,
    ) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      // Assigning width or height clears the canvas and reallocates its
      // drawing buffer, so only resize when the camera dimensions change.
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { hands, pose: showPose } = overlayOptionsRef.current;
      if (!hands) lastRenderedHands.fill(null);
      if (!hands && !showPose) return;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.imageSmoothingEnabled = true;

      const pose = showPose ? poseResult?.landmarks[0] : undefined;
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

      if (!hands) return;
      // Review swaps the display colors. Recognition uses the assigned
      // anatomical slots expected by the current checkpoints.
      const leftColor = assigned ? HAND_OVERLAY_COLORS.left : "#1F77B4";
      const rightColor = assigned ? HAND_OVERLAY_COLORS.right : "#FF7F0E";
      if (assigned) dropHeldCopies([assigned.rightHand, assigned.leftHand], video.videoWidth / video.videoHeight);
      const displayHands = assigned
        ? [[holdRenderedHand(0, assigned.rightHand, renderedAt), "Left"],
          [holdRenderedHand(1, assigned.leftHand, renderedAt), "Right"]] as const
        : handResult?.landmarks.map((hand, index) => [hand, displayHandSide(handResult.handedness?.[index]?.[0]?.categoryName)] as const) ?? [];
      for (const [hand, side] of displayHands) {
        if (!hand) continue;
        ctx.strokeStyle = side === "Left" ? leftColor : side === "Right" ? rightColor : "#FFFFFF";
        ctx.fillStyle = assigned
          ? ctx.strokeStyle
          : side === "Left" ? rightColor : side === "Right" ? leftColor : "#FFE83B";
        ctx.lineWidth = 4;

        for (const [start, end] of HAND_CONNECTIONS) {
          const p1 = hand[start];
          const p2 = hand[end];

          ctx.beginPath();
          ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
          ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
          ctx.stroke();
        }

        ctx.lineWidth = 2;
        for (const point of hand) {
          const x = point.x * canvas.width;
          const y = point.y * canvas.height;

          ctx.beginPath();
          ctx.arc(x, y, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // When one hand moves to the other side's slot, the side it left would be
    // held and extrapolated for HAND_OVERLAY_HOLD_MS, so one hand showed both
    // side colours. A held hand at the same place as the other side's fresh
    // hand is that same hand, and is cleared. Display only.
    function dropHeldCopies(fresh: [LandmarkPoint[] | null, LandmarkPoint[] | null], aspect: number) {
      for (const slot of [0, 1] as const) {
        const other = slot === 0 ? 1 : 0;
        const hand = fresh[slot], held = lastRenderedHands[other];
        if (!hand || fresh[other] || !held) continue;
        const a = overlayPalmCenter(hand), b = overlayPalmCenter(held);
        if (Math.hypot((a.x - b.x) * aspect, a.y - b.y) < 1.2 * overlayPalmSize(hand, aspect)) {
          lastRenderedHands[other] = null;
          renderedHandMotion[other] = null;
        }
      }
    }

    // Display continuity only. The observer and timing report use this frame's real detections.
    function holdRenderedHand(slot: 0 | 1, hand: LandmarkPoint[] | null, renderedAt: number) {
      if (hand) {
        const previous = lastRenderedHands[slot];
        const gap = renderedAt - lastRenderedHandsAt[slot];
        if (previous && gap > 0 && gap <= HAND_OVERLAY_HOLD_MS) {
          const from = overlayPalmCenter(previous), to = overlayPalmCenter(hand);
          renderedHandMotion[slot] = { x: (to.x - from.x) / gap, y: (to.y - from.y) / gap };
        } else {
          renderedHandMotion[slot] = null;
        }
        lastRenderedHands[slot] = hand;
        lastRenderedHandsAt[slot] = renderedAt;
        return hand;
      }
      const held = lastRenderedHands[slot];
      const elapsed = renderedAt - lastRenderedHandsAt[slot];
      if (!held || elapsed > HAND_OVERLAY_HOLD_MS) {
        lastRenderedHands[slot] = null;
        renderedHandMotion[slot] = null;
        return null;
      }
      const motion = renderedHandMotion[slot];
      if (!motion) return held;
      const step = Math.min(elapsed, HAND_OVERLAY_EXTRAPOLATE_MS);
      let dx = motion.x * step, dy = motion.y * step;
      const shift = Math.hypot(dx, dy);
      if (shift > HAND_OVERLAY_MAX_SHIFT) { dx *= HAND_OVERLAY_MAX_SHIFT / shift; dy *= HAND_OVERLAY_MAX_SHIFT / shift; }
      return held.map(point => ({ ...point, x: point.x + dx, y: point.y + dy }));
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
      profileRef.current.stop();
      benchmarkRef.current.stop();
      recentTimingRef.current.clear();
      discardPendingVideoFrame();
      discardPendingPose();
      if (rafId) cancelAnimationFrame(rafId);
      if (videoFrameId !== null) videoFrameSource?.cancelVideoFrameCallback(videoFrameId);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled, trackLiveTiming, trackOverlayPaint, decoupleVideoFrames, landmarkMode, poseStride, useHands, usePose, reviewHandTracking, lowLightAssist, requestedHandDelegate, captureProfile, handDetectionConfidence, deferPose, adaptiveHandCapacity]);

  // Full-unmount-only cleanup: release both MediaPipe models.
  useEffect(() => {
    return () => {
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      singleLandmarkerRef.current?.close();
      singleLandmarkerRef.current = null;
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
    lowLightAssistActive,
    error,
    modelError,
    enabled,
    toggleCamera,
    getLatestFrame,
    startPerformanceProfile,
    stopPerformanceProfile,
    getPerformanceReport,
    startLandmarkBenchmark,
    stopLandmarkBenchmark,
    getLiveTiming,
  };
}
// Exposure controls and current exposure as the browser reports them. These
// are optional track capabilities (Image Capture), so any of them may be absent.
function readCameraExposure(track: MediaStreamTrack | undefined): Record<string, unknown> | null {
  if (!track) return null;
  try {
    const capabilities = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
    const settings = track.getSettings() as Record<string, unknown>;
    const pick = (source: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
    return {
      capabilities: pick(capabilities, ["frameRate", "exposureMode", "exposureTime", "exposureCompensation", "brightness"]),
      settings: pick(settings, ["frameRate", "exposureMode", "exposureTime", "exposureCompensation", "brightness"]),
    };
  } catch {
    return null;
  }
}

// The preview uses the unmirrored camera image. Correct the detector's
// reported side for display only, leaving recognition features untouched.
function displayHandSide(category: string | undefined) {
  if (category === "Left") return "Right";
  if (category === "Right") return "Left";
  return undefined;
}

// Wrist to middle-finger base, in frame-height units; at least 0.02.
function overlayPalmSize(hand: LandmarkPoint[], aspect: number) {
  return Math.max(.02, Math.hypot((hand[0].x - hand[9].x) * aspect, hand[0].y - hand[9].y));
}

function overlayPalmCenter(hand: LandmarkPoint[]) {
  let x = 0, y = 0;
  for (const joint of HAND_OVERLAY_PALM_JOINTS) { x += hand[joint].x; y += hand[joint].y; }
  return { x: x / HAND_OVERLAY_PALM_JOINTS.length, y: y / HAND_OVERLAY_PALM_JOINTS.length };
}
