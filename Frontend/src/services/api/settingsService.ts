import { AppSettings } from '../../types/settings'
import { apiFetch, mockDelay, USE_MOCKS } from './client'
import mockSettings from '../../mocks/settings.json'

// Future FastAPI routes:
//   GET  /api/settings
//   PUT  /api/settings
export async function getSettings(): Promise<AppSettings> {
  if (USE_MOCKS) {
    return mockDelay(mockSettings as AppSettings)
  }
  return apiFetch<AppSettings>('/settings')
}

export async function updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
  if (USE_MOCKS) {
    return mockDelay({ ...(mockSettings as AppSettings), ...partial })
  }
  return apiFetch<AppSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(partial),
  })
}
