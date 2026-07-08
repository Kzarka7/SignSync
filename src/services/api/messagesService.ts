import { ConversationMessage } from '../../types/message'
import { apiFetch, mockDelay, USE_MOCKS } from './client'
import mockMessages from '../../mocks/messages.json'

// Future FastAPI route: GET /api/sessions/{id}/messages
export async function getMessagesForSession(sessionId: string): Promise<ConversationMessage[]> {
  if (USE_MOCKS) {
    return mockDelay((mockMessages as ConversationMessage[]).filter((m) => m.sessionId === sessionId))
  }
  return apiFetch<ConversationMessage[]>(`/sessions/${sessionId}/messages`)
}
