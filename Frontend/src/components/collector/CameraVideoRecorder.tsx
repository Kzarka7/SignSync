import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CollectorCameraPreview from './CollectorCameraPreview'
import RecordingControls from './RecordingControls'
import { IMPORT_FPS } from '../../services/dataset/videoImport'

export default function CameraVideoRecorder({ label, onRecorded, onBusy, controlsContainer, countdownSeconds = 0,
  onChangeCountdownSeconds = () => {}, durationLimitMs, onChangeDurationLimitMs = () => {} }: {
  label: string; onRecorded: (file: File, label: string, fps: number) => void; onBusy: (busy: boolean) => void
  controlsContainer?: HTMLElement | null
  countdownSeconds?: number; onChangeCountdownSeconds?: (seconds: number) => void
  durationLimitMs?: number; onChangeDurationLimitMs?: (duration: number | undefined) => void
}) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null)
  const recording = useRef<MediaRecorder | null>(null), alive = useRef(true), discard = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const countdownTimer = useRef<ReturnType<typeof setInterval>>()
  const canvas = useRef<HTMLCanvasElement>(null), processedFrames = useRef(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [opening, setOpening] = useState(false)
  const fps = IMPORT_FPS
  const [error, setError] = useState('')
  const onBusyRef = useRef(onBusy); onBusyRef.current = onBusy
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false; discard.current = true; clearTimeout(timer.current); clearInterval(countdownTimer.current)
      if (recording.current?.state !== 'inactive') recording.current?.stop()
      stream.current?.getTracks().forEach(track => track.stop()); onBusyRef.current(false)
    }
  }, [])
  useEffect(() => {
    if (ready && video.current && stream.current) {
      video.current.srcObject = stream.current
      void video.current.play().catch(() => setError('Camera preview could not start. Restart the camera.'))
    }
  }, [ready])
  useEffect(() => {
    if (!busy) return
    const began = Date.now(); setElapsed(0)
    const tick = setInterval(() => setElapsed((Date.now() - began) / 1000), 250)
    return () => clearInterval(tick)
  }, [busy])
  function cancelCountdown() {
    clearInterval(countdownTimer.current); setCountdown(null); onBusy(false)
  }
  function stop(shouldDiscard = false) {
    discard.current = shouldDiscard
    if (recording.current && recording.current.state !== 'inactive') recording.current.stop()
  }
  function requestStart() {
    if (!ready || busy || countdown !== null || !label.trim()) return
    if (countdownSeconds <= 0) { start(); return }
    let remaining = countdownSeconds
    setCountdown(remaining); onBusy(true)
    countdownTimer.current = setInterval(() => {
      remaining--
      if (remaining <= 0) { clearInterval(countdownTimer.current); setCountdown(null); start() }
      else setCountdown(remaining)
    }, 1000)
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.repeat || target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) return
      if (event.code === 'Space') {
        if (['BUTTON', 'SUMMARY', 'A'].includes(target?.tagName ?? '')) return
        event.preventDefault()
        if (busy) stop()
        else requestStart()
      } else if (event.code === 'Escape' && (busy || countdown !== null)) {
        event.preventDefault()
        if (countdown !== null) cancelCountdown()
        else stop(true)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [ready, busy, countdown, countdownSeconds, label, durationLimitMs])
  async function open() {
    setOpening(true); onBusy(true); setError('')
    try {
      if (typeof MediaRecorder === 'undefined') throw Error('This browser cannot preserve camera recordings. Use a phone camera and Upload videos.')
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: fps, max: fps } } })
      if (!alive.current) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      if (video.current) { video.current.srcObject = media; await video.current.play() }
      setReady(true)
    } catch (error) { if (alive.current) { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setError(error instanceof Error ? error.message : 'Could not open camera.') } }
    finally { if (alive.current) { setOpening(false); onBusy(false) } }
  }
  function start() {
    if (!stream.current || !label.trim() || busy) return
    const assignedLabel = label.trim(), selectedFps = fps
    const chunks: Blob[] = []
    discard.current = false; setError('')
    try {
      const mimeType = ['video/webm;codecs=vp8', 'video/mp4', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw Error('No supported recording format. Record using your phone and upload the file.')
      const recorder = new MediaRecorder(stream.current, { mimeType, videoBitsPerSecond: 8000000 })
      recording.current = recorder
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => { discard.current = true; clearTimeout(timer.current); if (alive.current) { setError('Camera recording failed. Try another take.'); setBusy(false); onBusy(false) } }
      recorder.onstop = () => {
        clearTimeout(timer.current)
        if (!alive.current) return
        setBusy(false); onBusy(false)
        if (discard.current) return
        const blob = new Blob(chunks, { type: recorder.mimeType })
        if (!blob.size) { setError('The recording is empty. Try another take.'); return }
        const suffix = recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'
        const name = `${assignedLabel.replace(/[^a-z0-9_-]/gi, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.${suffix}`
        onRecorded(new File([blob], name, { type: blob.type }), assignedLabel, selectedFps)
      }
      recorder.start(500); setBusy(true); onBusy(true)
      timer.current = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, Math.min(durationLimitMs ?? 120000, 120000))
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not record video.'); setBusy(false); onBusy(false) }
  }
  const controls = <div className="space-y-3">
    <RecordingControls isRecording={busy} frameCount={0} processedFramesRef={processedFrames}
      recordingStatus={<>Recording · {elapsed.toFixed(1)}s</>} stopLabel="Stop & save video"
      canRecord={ready && !opening && !!label.trim()} countdown={countdown} countdownSeconds={countdownSeconds}
      onChangeCountdownSeconds={onChangeCountdownSeconds} durationLimitMs={durationLimitMs} onChangeDurationLimitMs={onChangeDurationLimitMs}
      onStart={requestStart} onCancelCountdown={cancelCountdown} onStop={() => stop()} onDiscard={() => stop(true)} />
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </div>
  return <div className="space-y-4">
    <CollectorCameraPreview countdown={countdown} showTrackingStatus={false} cameraToggleDisabled={opening || busy || countdown !== null}
      feed={{ enabled: ready || opening, cameraReady: ready, videoRef: video, canvasRef: canvas,
        error, modelError: null, handsDetected: false, poseDetected: false,
        toggleCamera: () => {
          if (ready) { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setReady(false) }
          else void open()
        } }} />
    {controlsContainer ? createPortal(controls, controlsContainer) : controls}
  </div>
}
