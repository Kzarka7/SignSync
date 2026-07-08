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

  return { messages, endSession, exportSession }
}
