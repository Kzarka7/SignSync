import { useEffect, useRef, useState, type RefObject } from 'react'
import { FilesetResolver, HandLandmarker, type HandLandmarkerResult } from '@mediapipe/tasks-vision'

// Decoupled from VITE_USE_MOCKS for the same reason speech recognition is:
// camera access is a browser capability, not a backend call. Defaults to
// "false" (use the real camera + MediaPipe) now that a real
// implementation exists.
const USE_MOCK_CAMERA = (import.meta.env.VITE_USE_MOCK_CAMERA ?? 'false') === 'true'

// MediaPipe's hosted WASM runtime and hand-landmark model. Fetched by the
// browser at runtime, not bundled - no local model files to manage.
const WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

// Average frame brightness (0-255 scale) below this triggers the low-light
// warning. Tuned loosely - revisit once you've tested in an actual
// hospital/office lighting setting.
const LIGHT_WARNING_THRESHOLD = 70

// Frames are downscaled to this tiny canvas before averaging brightness -
// reading full-resolution pixel data every frame would be wasteful.
const BRIGHTNESS_SAMPLE_SIZE = 32

export interface CameraFeedState {
  videoRef: RefObject<HTMLVideoElement>
  canvasRef: RefObject<HTMLCanvasElement>
  cameraReady: boolean
  handsDetected: boolean
  lightLevel: 'ready' | 'warning'
  error: string | null
}

// Owns the camera stream and the MediaPipe HandLandmarker detection loop.
// Renders nothing itself - callers attach `videoRef`/`canvasRef` to their
// own <video>/<canvas> elements and read the derived state (hands
// detected, light level) to drive status pills elsewhere on the page.
export function useCameraFeed(): CameraFeedState {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [cameraReady, setCameraReady] = useState(false)
  const [handsDetected, setHandsDetected] = useState(false)
  const [lightLevel, setLightLevel] = useState<'ready' | 'warning'>('ready')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (USE_MOCK_CAMERA) {
      // Preserves the old mocked-timer behaviour for demoing without a
      // webcam, or on a machine where camera access isn't possible.
      const timer = setInterval(() => {
        setHandsDetected(Math.random() > 0.2)
        setLightLevel(Math.random() > 0.85 ? 'warning' : 'ready')
      }, 6000)
      setCameraReady(true)
      return () => clearInterval(timer)
    }

    let stream: MediaStream | null = null
    let landmarker: HandLandmarker | null = null
    let rafId: number | null = null
    let cancelled = false

    async function setup() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
        if (cancelled) return

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCameraReady(true)

        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL)
        landmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL },
          runningMode: 'VIDEO',
          numHands: 2,
        })

        sampleCanvasRef.current = document.createElement('canvas')
        sampleCanvasRef.current.width = BRIGHTNESS_SAMPLE_SIZE
        sampleCanvasRef.current.height = BRIGHTNESS_SAMPLE_SIZE

        detectLoop()
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera access was denied. Allow camera access in your browser to use live detection.'
            : 'Could not access the camera. Check that no other app is using it.',
        )
      }
    }

    function detectLoop() {
      if (cancelled || !videoRef.current || !landmarker) return

      const video = videoRef.current
      if (video.readyState >= 2) {
        const result: HandLandmarkerResult = landmarker.detectForVideo(video, performance.now())
        setHandsDetected(result.landmarks.length > 0)
        drawOverlay(result)
        updateLightLevel(video)
      }

      rafId = requestAnimationFrame(detectLoop)
    }

    // Draws small dots over each detected hand landmark onto the overlay
    // canvas, positioned to exactly match the underlying video element.
    function drawOverlay(result: HandLandmarkerResult) {
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#2D7FF9'

      for (const hand of result.landmarks) {
        for (const point of hand) {
          ctx.beginPath()
          ctx.arc(point.x * canvas.width, point.y * canvas.height, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    function updateLightLevel(video: HTMLVideoElement) {
      const sampleCanvas = sampleCanvasRef.current
      if (!sampleCanvas) return
      const ctx = sampleCanvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(video, 0, 0, BRIGHTNESS_SAMPLE_SIZE, BRIGHTNESS_SAMPLE_SIZE)
      const { data } = ctx.getImageData(0, 0, BRIGHTNESS_SAMPLE_SIZE, BRIGHTNESS_SAMPLE_SIZE)

      let total = 0
      for (let i = 0; i < data.length; i += 4) {
        total += (data[i] + data[i + 1] + data[i + 2]) / 3
      }
      const avgBrightness = total / (data.length / 4)
      setLightLevel(avgBrightness < LIGHT_WARNING_THRESHOLD ? 'warning' : 'ready')
    }

    setup()

    return () => {
      cancelled = true
      if (rafId) cancelAnimationFrame(rafId)
      stream?.getTracks().forEach((track) => track.stop())
      landmarker?.close()
    }
  }, [])

  return { videoRef, canvasRef, cameraReady, handsDetected, lightLevel, error }
}
