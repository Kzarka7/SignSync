import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfidenceBreakdown, ConversationMessage, SignPrediction, SignRequest, RecognitionMode } from '../types/message'
import { createTranslationSocket, ITranslationSocket } from '../services/ws/translationSocket'
import { averageConfidence } from '../utils/confidence'
import { useSessionStore } from '../store/sessionStore'

export function useTranslationStream(externalRecognition = false) {
  const [mode, setMode] = useState<RecognitionMode>('v5')
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [connection, setConnection] = useState<'loading' | 'ready' | 'disconnected'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [prediction, setPrediction] = useState<SignPrediction | null>(null)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const socketRef = useRef<ITranslationSocket | null>(null)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const added = useRef(new Set<string>())

  const clearPending = useCallback(() => {
    pending.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setBusy(false)
  }, [])

  useEffect(() => {
    if (externalRecognition) return
    const socket = createTranslationSocket(mode)
    socketRef.current = socket
    setConnection('loading')
    setError(null)
    setPrediction(null)
    clearPending()
    socket.connect((event) => {
      if (event.type === 'status') {
        setConnection(event.payload.state)
        if (event.payload.state === 'disconnected') clearPending()
      } else if (event.type === 'error') {
        setError(event.payload.message)
        clearPending()
      } else if (event.type === 'prediction' && event.payload.requestId === pending.current) {
        setPrediction(event.payload)
        const result = event.payload
        if (mode === 'p4-candidate' && result.accepted && !result.rejectionReason
            && !['REST', 'IDLE', 'IDLE_MOVEMENT'].includes(result.label)
            && !added.current.has(result.requestId)) {
          added.current.add(result.requestId)
          const confidence = Math.round(result.score * 1000) / 10
          setMessages(prev => [...prev, {
            id: result.requestId, sessionId: useSessionStore.getState().sessionId ?? 'live',
            source: 'sign', text: result.label.replace(/_/g, ' '), timestamp: new Date().toISOString(),
            confidence, confidenceBreakdown: { handSignRecognition: confidence },
          }])
        }
        clearPending()
      }
    })
    return () => {
      socket.disconnect()
      if (timer.current) clearTimeout(timer.current)
      pending.current = null
    }
  }, [attempt, clearPending, mode, externalRecognition])

  const appendConfirmedSign = useCallback((entry: {requestId: string; label: string; score: number}) => {
    if (!externalRecognition || added.current.has(entry.requestId) || ['REST','IDLE','IDLE_MOVEMENT'].includes(entry.label)) return
    added.current.add(entry.requestId)
    const confidence = Math.round(entry.score * 1000) / 10
    setMessages(prev => [...prev, {id:entry.requestId, sessionId:useSessionStore.getState().sessionId ?? 'live',
      source:'sign',text:entry.label.replace(/_/g,' '),timestamp:new Date().toISOString(),
      confidence,confidenceBreakdown:{handSignRecognition:confidence}}])
  }, [externalRecognition])

  const sendSign = useCallback((request: SignRequest) => {
    if (connection !== 'ready' || pending.current) return false
    setError(null)
    setPrediction(null)
    pending.current = request.requestId
    if (!socketRef.current?.sendSign(request)) {
      clearPending()
      setError('Recognition is not connected. Reconnect and record again.')
      return false
    }
    setBusy(true)
    timer.current = setTimeout(() => {
      clearPending()
      setError('Recognition timed out. Reconnect before trying again.')
      setConnection('disconnected')
      socketRef.current?.disconnect()
    }, 30000)
    return true
  }, [connection, clearPending])

  const addPrediction = () => {
    if (mode !== 'v5' || !prediction?.accepted || added.current.has(prediction.requestId)) return
    added.current.add(prediction.requestId)
    const confidence = Math.round(prediction.score * 100)
    setMessages(prev => [...prev, {
      id: prediction.requestId, sessionId: useSessionStore.getState().sessionId ?? 'live',
      source: 'sign', text: prediction.label.replace(/_/g, ' '), timestamp: new Date().toISOString(),
      confidence, confidenceBreakdown: { handSignRecognition: confidence },
    }])
    setPrediction(null)
  }

  const endSession = () => {
    socketRef.current?.sendControl('end-session')
    socketRef.current?.disconnect()
    clearPending()
  }
  const exportSession = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'signsync-conversation.json'
    link.click()
    URL.revokeObjectURL(url)
  }
  const submitSpeech = (text: string) => {
    const confidenceBreakdown: ConfidenceBreakdown = { speechRecognition: 98, translation: 97 }
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), sessionId: useSessionStore.getState().sessionId ?? 'live', source: 'speech', text,
      timestamp: new Date().toISOString(), confidence: averageConfidence(confidenceBreakdown), confidenceBreakdown,
    }])
  }
  const submitPhrase = (text: string) => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), sessionId: useSessionStore.getState().sessionId ?? 'live', source: 'phrase', text,
      timestamp: new Date().toISOString(),
    }])
  }
  const selectMode = (next: RecognitionMode) => {
    if (next === mode || busy) return
    socketRef.current?.disconnect()
    clearPending()
    setConnection('loading')
    setPrediction(null)
    setError(null)
    setMode(next)
  }
  return { messages, endSession, exportSession, submitSpeech, submitPhrase, connection, error, mode, selectMode, appendConfirmedSign,
    prediction, busy, sendSign, addPrediction, reconnect: () => setAttempt(a => a + 1) }
}
