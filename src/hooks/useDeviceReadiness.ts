import { useCallback, useEffect, useState } from 'react'

export type ReadinessState = 'checking' | 'ready' | 'warning' | 'error'
export type SpeakerState = 'idle' | 'checking' | 'ready' | 'error'

export interface DeviceReadiness {
  camera: ReadinessState
  microphone: ReadinessState
  speaker: SpeakerState
  testSpeaker: () => void
  recheckDevices: () => void
}

// A lightweight, one-time readiness probe - distinct from
// useCameraFeed/useSpeechRecognition, which run continuous detection.
// This hook exists purely to confirm hardware + permissions work on the
// Session Setup page, before any real detection starts. It acquires the
// camera/microphone only long enough to confirm they work, then
// immediately releases them - no MediaPipe model is loaded here.
//
// There's no mock version of this hook: unlike swapping a translation
// backend, "mocking" a hardware permission check wouldn't tell you
// anything real about whether the device works, so this is always a
// genuine browser capability check, real from day one.
export function useDeviceReadiness(): DeviceReadiness {
  const [camera, setCamera] = useState<ReadinessState>('checking')
  const [microphone, setMicrophone] = useState<ReadinessState>('checking')
  const [speaker, setSpeaker] = useState<SpeakerState>('idle')

  const recheckDevices = useCallback(() => {
    setCamera('checking')
    setMicrophone('checking')

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        setCamera(stream.getVideoTracks().length > 0 ? 'ready' : 'warning')
        setMicrophone(stream.getAudioTracks().length > 0 ? 'ready' : 'warning')
        // Only verifying readiness here - release immediately. Actual
        // detection starts later via useCameraFeed/useSpeechRecognition,
        // only once the user presses "Begin Conversation".
        stream.getTracks().forEach((track) => track.stop())
      })
      .catch((err) => {
        console.error('[useDeviceReadiness] Camera/microphone check failed:', err)
        setCamera('error')
        setMicrophone('error')
      })
  }, [])

  useEffect(() => {
    recheckDevices()
  }, [recheckDevices])

  function testSpeaker() {
    try {
      setSpeaker('checking')
      // No browser API can auto-detect whether a speaker actually works,
      // so this plays a genuine short tone via the Web Audio API - if
      // playback succeeds without throwing, we call it "ready"; the user
      // confirms the rest by actually hearing it.
      const AudioCtor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtor()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = 880 // a gentle, clearly audible tone
      gain.gain.setValueAtTime(0.15, ctx.currentTime)

      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start()
      oscillator.stop(ctx.currentTime + 0.35)

      oscillator.onended = () => {
        setSpeaker('ready')
        ctx.close()
      }
    } catch (err) {
      console.error('[useDeviceReadiness] Speaker test failed:', err)
      setSpeaker('error')
    }
  }

  return { camera, microphone, speaker, testSpeaker, recheckDevices }
}
