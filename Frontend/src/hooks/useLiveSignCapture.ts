import { useCallback, useEffect, useRef, useState } from 'react'
import { useCameraFeed } from './useCameraFeed'
import { FEATURE_ORDER, toFeatureVector } from '../services/landmarks/normalize'
import type { LandmarkFrameSample } from '../types/landmarks'
import type { SignRequest } from '../types/message'

export function useLiveSignCapture(sendSign: (request: SignRequest) => boolean, ready: boolean) {
  const [phase, setPhase] = useState<'idle' | 'countdown' | 'recording'>('idle')
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const buffer = useRef<SignRequest['frames']>([])
  const recording = useRef(false)
  const countdown = useRef<ReturnType<typeof setTimeout> | null>(null)
  const limit = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancel = useCallback(() => {
    recording.current = false
    if (countdown.current) clearTimeout(countdown.current)
    if (limit.current) clearTimeout(limit.current)
    countdown.current = null
    limit.current = null
    buffer.current = []
    setPhase('idle')
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
    if (!recording.current) return
    buffer.current.push({ timestamp: sample.timestamp, ...toFeatureVector(sample) })
    setCount(buffer.current.length)
    if (buffer.current.length >= 240) finishRef.current()
  }, [])
  const feed = useCameraFeed({ onFrame })

  useEffect(() => {
    if (!feed.enabled || !ready || feed.error || feed.modelError) cancel()
  }, [feed.enabled, feed.error, feed.modelError, ready, cancel])
  useEffect(() => () => {
    recording.current = false
    if (countdown.current) clearTimeout(countdown.current)
    if (limit.current) clearTimeout(limit.current)
  }, [])

  const start = () => {
    if (!ready || !feed.cameraReady || !feed.poseDetected || phase !== 'idle') return
    setError(null)
    setPhase('countdown')
    countdown.current = setTimeout(() => {
      countdown.current = null
      buffer.current = []
      recording.current = true
      setPhase('recording')
      limit.current = setTimeout(() => finishRef.current(), 8000)
    }, 2000)
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.isContentEditable || target?.closest('input, textarea, select, [role="textbox"], [role="combobox"], [role="dialog"]')) return

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
  }, [phase, start, finish, cancel])

  return { feed, phase, count, error, start, finish, cancel }
}
