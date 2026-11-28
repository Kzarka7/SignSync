import { useCallback, useEffect, useRef, useState } from 'react'
import { LIVE_RECOGNITION_CAMERA_OPTIONS, useCameraFeed } from './useCameraFeed'

// Same UI refresh interval as the Recognition Lab camera (CAMERA_SNAPSHOT_INTERVAL_MS).
const STATUS_INTERVAL_MS = 125
import { createDiagnosticSession, type LabTranscriptEntry } from '../services/landmarks/recognitionDiagnostics'
import { createDiagnosticPredictor } from '../services/ws/diagnosticPredictor'
import { getRecognitionConfirmation, LIVE_MOTION_PROFILE, LIVE_RECOGNITION_POLICY, LIVE_SIGNS_MODEL } from '../services/landmarks/liveRecognitionPolicy'
import type { LandmarkFrameSample } from '../types/landmarks'

export function useContinuousLiveRecognition(onAccepted: (entry: LabTranscriptEntry) => void, {
  mode = 'signs',
  onWordBoundary,
}: { mode?: 'signs' | 'fingerspelling'; onWordBoundary?: () => void } = {}) {
  const session = useRef<ReturnType<typeof createDiagnosticSession> | null>(null)
  const predictor = useRef<ReturnType<typeof createDiagnosticPredictor> | null>(null)
  const generation = useRef(0)
  const accepted = useRef(onAccepted)
  accepted.current = onAccepted
  const wordBoundary = useRef(onWordBoundary)
  wordBoundary.current = onWordBoundary
  const [running,setRunning] = useState(false)
  const [loading,setLoading] = useState(false)
  const [countdown,setCountdown] = useState<number|null>(null)
  const [countdownSeconds,setCountdownSeconds] = useState(0)
  const countdownTimer = useRef<ReturnType<typeof setInterval>|null>(null)
  const [status,setStatus] = useState('Ready')
  const [error,setError] = useState<string|null>(null)
  const statusTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const clearStatusTimer = useCallback(() => {
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = null
  }, [])
  const stop = useCallback(() => {
    generation.current++
    clearStatusTimer()
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    countdownTimer.current=null; setCountdown(null)
    const current = session.current
    session.current = null
    current?.stop()
    predictor.current?.close(); predictor.current = null
    setRunning(false); setLoading(false); setStatus('Stopped')
  }, [clearStatusTimer])
  const onFrame = useCallback((sample:LandmarkFrameSample) => {
    if (!session.current?.active) return
    void session.current.observe(sample).catch(() => { stop(); setError('Recognition interrupted. Start again.') })
  }, [stop])
  // Same camera pipeline as the Recognition Lab's defaults (detection size, pose striding, one-hand mode).
  const feed = useCameraFeed({ ...LIVE_RECOGNITION_CAMERA_OPTIONS, onFrame })
  useEffect(() => {
    if (!feed.enabled || feed.error || feed.modelError) stop()
  }, [feed.enabled,feed.error,feed.modelError,stop])
  useEffect(() => () => {
    generation.current++
    clearStatusTimer()
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    const current=session.current; session.current=null; current?.stop()
    predictor.current?.close(); predictor.current=null
  }, [clearStatusTimer])
  const start = async () => {
    if (predictor.current || !feed.cameraReady || !feed.poseDetected) return
    const alphabet = mode === 'fingerspelling'
    const modelMode = alphabet ? 'lab-alphabet' : LIVE_SIGNS_MODEL
    const confirmation = getRecognitionConfirmation()
    const token=++generation.current, transport=createDiagnosticPredictor(modelMode)
    predictor.current=transport; setLoading(true); setError(null); setStatus('Loading model…')
    try {
      await transport.connect()
      if (token!==generation.current) return
      const begin = () => {
      if (token!==generation.current) return
      setCountdown(null)
      let delivered=0, lastStatusAt=-Infinity
      const publishStatus=()=>{
        clearStatusTimer()
        if (token!==generation.current || session.current!==current) return
        lastStatusAt=Date.now()
        const state=current.state, tracking=state.tracking?.state
        setStatus(tracking==='no-hands' ? 'IDLE' : tracking && tracking!=='visible' ? 'Tracking interrupted'
          : state.segmentationPhase==='observing' ? 'Observing' : state.status.replace(/_/g,' '))
      }
      const current=createDiagnosticSession({source:'camera',name:'Live conversation',...LIVE_RECOGNITION_POLICY,
        modelMode, ...confirmation,
        // Same camera session settings as the Recognition Lab.
        wallClockWindows: true, poseGuidedOcclusion: true,
        staticMotionCheck: modelMode === LIVE_SIGNS_MODEL,
        ...(modelMode === LIVE_SIGNS_MODEL ? { motionProfile: LIVE_MOTION_PROFILE } : {}),
        settleConfirmedHold: alphabet,
        onWordBoundary: alphabet ? () => {
          if (token === generation.current && session.current === current) wordBoundary.current?.()
        } : undefined,
        predict:request=>transport.predict(request),onChange:()=>{
          if (token!==generation.current || session.current!==current) return
          const state=current.state
          for (;delivered<state.transcript.length;delivered++) accepted.current(state.transcript[delivered])
          // Status re-renders at most every 125 ms, as in the Lab; accepted signs above are delivered at once.
          const wait=STATUS_INTERVAL_MS-(Date.now()-lastStatusAt)
          if (wait<=0) publishStatus()
          else statusTimer.current??=setTimeout(publishStatus,wait)
          if (!current.active) { const failure=state.failure; const message=state.status; stop(); setStatus(message); setError(failure) }
        }})
      session.current=current; setLoading(false); setRunning(true); setStatus('Observing')
      }
      let remaining=countdownSeconds
      if (remaining===0) { begin(); return }
      setLoading(false); setCountdown(remaining); setStatus('Starting…')
      countdownTimer.current=setInterval(()=>{
        if (token!==generation.current) return
        remaining--
        if (remaining>0) setCountdown(remaining)
        else {
          if (countdownTimer.current) clearInterval(countdownTimer.current)
          countdownTimer.current=null; begin()
        }
      },1000)
    } catch (cause) {
      if (token!==generation.current) return
      stop(); setError(String(cause))
    }
  }
  useEffect(() => {
    const key=(event:KeyboardEvent)=>{
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target=event.target as HTMLElement|null
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"], [role="combobox"], [role="dialog"]')) return
      if (event.key==='Escape') { if(predictor.current){event.preventDefault();stop()} }
      else if(event.code==='Space' || event.key===' ') {
        if(target?.closest?.('button, a, [role="button"], [role="slider"]') && !target.closest('[data-sign-capture-control]')) return
        event.preventDefault()
        if(predictor.current)stop();else void start()
      }
    }
    window.addEventListener('keydown',key)
    return ()=>window.removeEventListener('keydown',key)
  }, [stop,start])
  return {feed,running,loading,status,error,start,stop,countdown,countdownSeconds,
    setCountdownSeconds:(seconds:number)=>{if(!predictor.current && Number.isInteger(seconds) && seconds >= 0 && seconds <= 120)setCountdownSeconds(seconds)}}
}
