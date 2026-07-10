import { useRef, useState } from 'react'
import { createSpeechRecognitionService, ISpeechRecognitionService } from '../services/speech/speechRecognitionService'

export function useSpeechRecognition() {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const serviceRef = useRef<ISpeechRecognitionService | null>(null)

  function start() {
    const service = createSpeechRecognitionService()
    serviceRef.current = service
    setTranscript('')
    setIsListening(true)
    service.start((update) => setTranscript(update.text))
  }

  function stop() {
    serviceRef.current?.stop()
    setIsListening(false)
  }

  function reset() {
    setTranscript('')
  }

  return { isListening, transcript, start, stop, reset }
}
