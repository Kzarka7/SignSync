// Mirrors the shape the future FastAPI `/sessions` endpoints will return.
export interface ConversationSession {
  id: string
  title: string
  location: string
  startedAt: string // ISO 8601
  durationMinutes: number
  messageCount: number
  avgConfidence: number // 0-100
}
