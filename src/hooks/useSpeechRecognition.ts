import { useRef, useState } from 'react'
import { createSpeechRecognitionService, ISpeechRecognitionService } from '../services/speech/speechRecognitionService'

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const serviceRef = useRef<ISpeechRecognitionService | null>(null)

  function start() {
    const service = createSpeechRecognitionService()
    serviceRef.current = service
    setTranscript('')
    setError(null)
    setIsListening(true)
    service.start(
      (update) => setTranscript(update.text),
      (message) => {
        setError(message)
        setIsListening(false)
      },
    )
  }

  function stop() {
    serviceRef.current?.stop()
    setIsListening(false)
  }

  function reset() {
    setTranscript('')
    setError(null)
  }

  return { isListening, transcript, error, start, stop, reset }
}
