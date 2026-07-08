// Mirrors a single translated utterance, whether it originates from the
// sign-detection pipeline or the speech-to-text pipeline.
export type MessageSource = 'sign' | 'speech'

export interface ConversationMessage {
  id: string
  sessionId: string
  source: MessageSource
  text: string
  timestamp: string // ISO 8601
  confidence: number // 0-100, from the ML model
}

// The envelope the future WebSocket stream will emit. Kept separate from
// ConversationMessage so transport-level fields never leak into UI state.
export interface TranslationSocketEvent {
  type: 'translation' | 'status' | 'error'
  payload: ConversationMessage | DeviceStatusEvent | { message: string }
}

export interface DeviceStatusEvent {
  camera?: string
  hands?: string
  face?: string
  microphone?: string
  speaker?: string
  ai?: string
  lightLevel?: string
}
