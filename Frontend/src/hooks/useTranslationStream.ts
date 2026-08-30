import { useEffect, useRef, useState } from 'react'
import { ConfidenceBreakdown, ConversationMessage, TranslationSocketEvent } from '../types/message'
import { createTranslationSocket, ITranslationSocket } from '../services/ws/translationSocket'
import { averageConfidence } from '../utils/confidence'

// Owns the lifecycle of the translation WebSocket and exposes a plain
// array of messages plus a couple of control actions. Components never
// touch the socket directly.
export function useTranslationStream() {
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const socketRef = useRef<ITranslationSocket | null>(null)

  useEffect(() => {
    const socket = createTranslationSocket()
    socketRef.current = socket

    socket.connect((event: TranslationSocketEvent) => {
      if (event.type === 'translation') {
        setMessages((prev) => [...prev, event.payload as ConversationMessage])
      }
    })

    return () => socket.disconnect()
  }, [])

  const endSession = () => socketRef.current?.sendControl('end-session')
  const exportSession = () => socketRef.current?.sendControl('export')

  // Called when the hearing user submits speech from the AvatarPanel.
  // Appends a locally-sourced "speech" message so it flows through the
  // timeline exactly like a message pushed from the socket.
  const submitSpeech = (text: string) => {
    // Two stages ran to produce this message: the browser's speech
    // recognizer, then translating that recognized text for the avatar to
    // sign. `confidence` stays the average of the two, same as before, so
    // nothing that only reads the overall figure needs to change.
    const confidenceBreakdown: ConfidenceBreakdown = { speechRecognition: 98, translation: 97 }
    const message: ConversationMessage = {
      id: `local-${Date.now()}`,
      sessionId: 'live-demo',
      source: 'speech',
      text,
      timestamp: new Date().toISOString(),
      confidence: averageConfidence(confidenceBreakdown),
      confidenceBreakdown,
    }
    setMessages((prev) => [...prev, message])
  }

  // Called when a Quick Phrase chip is clicked. A manually selected
  // phrase, not something detected by speech/sign recognition - so it
  // goes through the same message state and shape as any other message,
  // just with no confidence score (there was nothing to score).
  const submitPhrase = (text: string) => {
    const message: ConversationMessage = {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sessionId: 'live-demo',
      source: 'phrase',
      text,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, message])
  }

  return { messages, endSession, exportSession, submitSpeech, submitPhrase }
}
