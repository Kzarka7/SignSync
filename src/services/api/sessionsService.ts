import { ConversationSession } from '../../types/session'
import { apiFetch, mockDelay, USE_MOCKS } from './client'
import mockSessions from '../../mocks/sessions.json'

// Future FastAPI routes this maps to:
//   GET /api/sessions
//   GET /api/sessions?limit=N
//   GET /api/sessions/{id}

export async function getRecentSessions(limit = 5): Promise<ConversationSession[]> {
  if (USE_MOCKS) {
    return mockDelay((mockSessions as ConversationSession[]).slice(0, limit))
  }
  return apiFetch<ConversationSession[]>(`/sessions?limit=${limit}`)
}

export async function getAllSessions(): Promise<ConversationSession[]> {
  if (USE_MOCKS) {
    return mockDelay(mockSessions as ConversationSession[])
  }
  return apiFetch<ConversationSession[]>('/sessions')
}

export async function getSessionById(id: string): Promise<ConversationSession | undefined> {
  if (USE_MOCKS) {
    return mockDelay((mockSessions as ConversationSession[]).find((s) => s.id === id))
  }
  return apiFetch<ConversationSession>(`/sessions/${id}`)
}
