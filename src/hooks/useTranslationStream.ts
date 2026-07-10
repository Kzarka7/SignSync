import { useEffect, useRef, useState } from 'react'
import { ConversationMessage, TranslationSocketEvent } from '../types/message'
import { createTranslationSocket, ITranslationSocket } from '../services/ws/translationSocket'

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
    const message: ConversationMessage = {
      id: `local-${Date.now()}`,
      sessionId: 'live-demo',
      source: 'speech',
      text,
      timestamp: new Date().toISOString(),
      confidence: 99,
    }
    setMessages((prev) => [...prev, message])
  }

  return { messages, endSession, exportSession, submitSpeech }
}
