import { useEffect, useRef, useState, type RefObject } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

// MediaPipe's hosted WASM runtime and models. Fetched by the browser at
// runtime, not bundled - no local model files to manage.
const WASM_BASE_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

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
  lightLevel: "ready" | "warning";
  error: string | null;
  modelError: string | null;
  enabled: boolean;
  toggleCamera: () => void;
}

// Owns the camera stream and the MediaPipe HandLandmarker detection loop.
// Renders nothing itself - callers attach `videoRef`/`canvasRef` to their
// own <video>/<canvas> elements and read the derived state (hands
// detected, light level) to drive status pills elsewhere on the page.
//
// `autoStart` lets a caller begin detection immediately (e.g. Live
// Conversation, arriving from Session Setup where the user already
// confirmed device readiness and pressed "Begin Conversation") instead of
// requiring a further manual Start click.
export function useCameraFeed(): CameraFeedState {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Persisted across start/stop toggles (not recreated every time) since
  // loading the MediaPipe model takes a second or two - only closed on
  // full component unmount, see the effect below.
  const landmarkerRef = useRef<HandLandmarker | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [handsDetected, setHandsDetected] = useState(false);
  const [lightLevel, setLightLevel] = useState<"ready" | "warning">("ready");
  const [error, setError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  const toggleCamera = () => setEnabled((prev) => !prev);

  useEffect(() => {
    if (!enabled) {
      setCameraReady(false);
      setHandsDetected(false);
      setLightLevel("ready");
      setError(null);
      setModelError(null);
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

      // Separate try/catch on purpose: a failure here means the hand
      // detection model didn't load (usually a network issue fetching it
      // from Google's hosted CDN) - it has nothing to do with camera
      // access, so it must not be reported as a camera error, and the
      // video feed you can already see should keep working even without
      // detection running.
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
        const result: HandLandmarkerResult =
          landmarkerRef.current.detectForVideo(video, video.currentTime * 1000);
        setHandsDetected(result.landmarks.length > 0);
        drawOverlay(result);
        updateLightLevel(video);
      }

      rafId = requestAnimationFrame(detectLoop);
    }

    // Draws small dots over each detected hand landmark onto the overlay
    // canvas, positioned to exactly match the underlying video element.
    function drawOverlay(result: HandLandmarkerResult) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const hand of result.landmarks) {
        ctx.strokeStyle = "#00FF00";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.imageSmoothingEnabled = true;

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
    };
  }, []);

  return {
    videoRef,
    canvasRef,
    cameraReady,
    handsDetected,
    lightLevel,
    error,
    modelError,
    enabled,
    toggleCamera,
  };
}
