import { QuickPhrase } from '../../types/phrase'
import { apiFetch, mockDelay, USE_MOCKS } from './client'
import mockPhrases from '../../mocks/phrases.json'

// Future FastAPI route: GET /api/phrases?category=medical
export async function getPhrases(category?: QuickPhrase['category']): Promise<QuickPhrase[]> {
  const all = mockPhrases as QuickPhrase[]
  if (USE_MOCKS) {
    return mockDelay(category ? all.filter((p) => p.category === category) : all)
  }
  const query = category ? `?category=${category}` : ''
  return apiFetch<QuickPhrase[]>(`/phrases${query}`)
}
