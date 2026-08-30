// Mirrors a single translated utterance, whether it originates from the
// sign-detection pipeline, the speech-to-text pipeline, or a manually
// selected quick phrase.
export type MessageSource = 'sign' | 'speech' | 'phrase'

// One score per recognition/translation pipeline stage. Which keys show
// up depends on the message's source - a 'sign' message never carries
// speechRecognition, a 'speech' message never carries handSignRecognition -
// never invent a score for a stage that didn't run on that message.
export type ConfidenceCategory = 'handSignRecognition' | 'speechRecognition' | 'translation'
export type ConfidenceBreakdown = Partial<Record<ConfidenceCategory, number>>

export interface ConversationMessage {
  id: string
  sessionId: string
  source: MessageSource
  text: string
  timestamp: string // ISO 8601
  // 0-100, from the ML model. Absent for manually-selected phrases, which
  // were never run through detection - never fake a number here. When
  // confidenceBreakdown is present, this is that breakdown's average -
  // kept alongside it so existing average-only views (Live Conversation,
  // the History list) don't need to know about categories at all.
  confidence?: number
  // Per-stage detail behind `confidence` above. Absent wherever
  // `confidence` itself is absent (phrases).
  confidenceBreakdown?: ConfidenceBreakdown
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
