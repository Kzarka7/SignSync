import { useCallback, useEffect, useRef, useState } from 'react'
import { useCameraFeed } from './useCameraFeed'
import { FEATURE_ORDER, toFeatureVector } from '../services/landmarks/normalize'
import type { LandmarkFrameSample } from '../types/landmarks'
import { createContinuousSignCapture } from '../services/landmarks/continuousSignCapture'
import type { SignRequest } from '../types/message'

export function useLiveSignCapture(sendSign: (request: SignRequest) => boolean, ready: boolean, candidate = false, connected = ready) {
  const [continuous, setContinuous] = useState(false)
  const [boundaryPhase, setBoundaryPhase] = useState('calibrating')
  const [queued, setQueued] = useState(0)
  const automatic = useRef<ReturnType<typeof createContinuousSignCapture> | null>(null)
  const queue = useRef<SignRequest[]>([])
  const transport = useRef({ sendSign, ready })
  transport.current = { sendSign, ready }
  const stopContinuous = useCallback(() => {
    automatic.current = null
    queue.current = []
    setQueued(0)
    setContinuous(false)
  }, [])
  const flush = useCallback(() => {
    if (transport.current.ready && queue.current.length && transport.current.sendSign(queue.current[0])) {
      queue.current.shift()
      setQueued(queue.current.length)
    }
  }, [])
  useEffect(() => { if (ready) flush() }, [ready, flush])
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'recording'>('idle')
  const [count, setCount] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [countdownSeconds, setCountdownSeconds] = useState(3)
  const [error, setError] = useState<string | null>(null)
  const buffer = useRef<SignRequest['frames']>([])
  const recording = useRef(false)
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    recording.current = false
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    if (limit.current) clearTimeout(limit.current)
    countdownTimer.current = null
    limit.current = null
    buffer.current = []
    setPhase('idle')
    setCountdown(null)
    setCount(0)
  }, [])

  const finish = useCallback(() => {
    if (!recording.current) return
    const frames = buffer.current
    cancel()
    if (frames.length < 8 || frames[frames.length - 1].timestamp - frames[0].timestamp < 400) {
      setError('Record a complete sign with at least 8 detected frames, then finish.')
      return
    }
    if (!sendSign({ requestId: crypto.randomUUID(), featureOrder: FEATURE_ORDER, frames })) {
      setError('Recognition is not ready. Reconnect and record again.')
    }
  }, [cancel, sendSign])

  const finishRef = useRef(finish)
  finishRef.current = finish
  const onFrame = useCallback((sample: LandmarkFrameSample) => {
    if (automatic.current) {
      for (const { event, frames } of automatic.current.push(sample)) {
        if (event.type === 'segment') {
          if (queue.current.length >= 6) {
            setError('Recognition queue is full. Pause signing until pending signs finish.')
          } else {
            setError(null)
            queue.current.push({ requestId: crypto.randomUUID(), featureOrder: FEATURE_ORDER, frames })
            setQueued(queue.current.length)
          }
        } else setError('Capture discarded: ' + event.reason.replace(/-/g, ' ') + '. Return to rest before signing again.')
      }
      setBoundaryPhase(automatic.current.phase)
      flush()
      return
    }
    if (!recording.current) return
    buffer.current.push({ timestamp: sample.timestamp, ...toFeatureVector(sample) })
    setCount(buffer.current.length)
    if (buffer.current.length >= 240) finishRef.current()
  }, [flush])
  const feed = useCameraFeed({ onFrame })

  useEffect(() => {
    if (!candidate || !connected || !feed.enabled || feed.error || feed.modelError) stopContinuous()
  }, [candidate, connected, feed.enabled, feed.error, feed.modelError, stopContinuous])
  const startContinuous = () => {
    if (!candidate || !ready || !feed.cameraReady || !feed.poseDetected) return
    cancel()
    setError(null)
    automatic.current = createContinuousSignCapture()
    setBoundaryPhase('calibrating')
    setContinuous(true)
  }
  useEffect(() => {
    if (!feed.enabled || !ready || feed.error || feed.modelError) cancel()
  }, [feed.enabled, feed.error, feed.modelError, ready, cancel])
  useEffect(() => () => {
    recording.current = false
    automatic.current = null
    queue.current = []
    if (countdownTimer.current) clearInterval(countdownTimer.current)
    if (limit.current) clearTimeout(limit.current)
  }, [])

  const start = () => {
    if (automatic.current || !ready || !feed.cameraReady || !feed.poseDetected || phase !== 'idle') return
    setError(null)
    const begin = () => {
      setCountdown(null)
      buffer.current = []
      recording.current = true
      setPhase('recording')
      limit.current = setTimeout(() => finishRef.current(), 8000)
    }
    if (countdownSeconds === 0) { begin(); return }
    setPhase('countdown')
    let remaining = countdownSeconds
    setCountdown(remaining)
    countdownTimer.current = setInterval(() => {
      remaining -= 1
      if (remaining > 0) { setCountdown(remaining); return }
      if (countdownTimer.current) clearInterval(countdownTimer.current)
      countdownTimer.current = null
      begin()
    }, 1000)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="dialog"]')) return

      if (automatic.current) {
        if (event.key === 'Escape') { event.preventDefault(); stopContinuous() }
        return
      }
      if (event.code === 'Space' || event.key === ' ') {
        // Keep native Space behavior on other controls; capture buttons are
        // handled here to prevent the same keypress also triggering a click.
        if (target?.closest('button, a, [role="button"], [role="slider"]') && !target.closest('[data-sign-capture-control]')) return
        event.preventDefault()
        if (event.repeat) return
        if (phase === 'idle') start()
        else if (phase === 'recording') finish()
      } else if (event.key === 'Escape' && phase !== 'idle') {
        event.preventDefault()
        if (!event.repeat) cancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, start, finish, cancel, stopContinuous])

  return { feed, phase, count, countdown, countdownSeconds, continuous, boundaryPhase, queued, startContinuous, stopContinuous,
    setCountdownSeconds: (seconds: number) => {
      if (phase === 'idle' && Number.isInteger(seconds) && seconds >= 0 && seconds <= 120) setCountdownSeconds(seconds)
    }, error, start, finish, cancel }
}
