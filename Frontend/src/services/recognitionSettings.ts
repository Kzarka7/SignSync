export const RECOGNITION_SETTING_LIMITS = {
  minimumConfidence: { min: 50, max: 100, step: 1 },
  acceptanceMs: { min: 100, max: 1000, step: 50 },
} as const

type RecognitionSettings = { minimumConfidence: number; acceptanceMs: number }
export const DEFAULT_RECOGNITION_SETTINGS = { minimumConfidence: 75, acceptanceMs: 300 } as const
const storageKey = 'signsync.recognitionSettings'
let unsavedSettings: RecognitionSettings | undefined

function validValue(key: keyof RecognitionSettings, value: number | undefined) {
  const { min, max } = RECOGNITION_SETTING_LIMITS[key]
  return value !== undefined && Number.isInteger(value) && value >= min && value <= max ? value : DEFAULT_RECOGNITION_SETTINGS[key]
}

export function getRecognitionSettings(): RecognitionSettings {
  if (unsavedSettings) return unsavedSettings
  try {
    const raw = localStorage.getItem(storageKey)
    const saved = raw ? JSON.parse(raw) as Partial<RecognitionSettings> | null : null
    return {
      minimumConfidence: validValue('minimumConfidence', saved?.minimumConfidence),
      acceptanceMs: validValue('acceptanceMs', saved?.acceptanceMs),
    }
  } catch {
    return { ...DEFAULT_RECOGNITION_SETTINGS }
  }
}

export function updateRecognitionSettings(partial: Partial<RecognitionSettings>): RecognitionSettings {
  const settings = { ...getRecognitionSettings(), ...partial }
  const next = {
    minimumConfidence: validValue('minimumConfidence', settings.minimumConfidence),
    acceptanceMs: validValue('acceptanceMs', settings.acceptanceMs),
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(next))
    unsavedSettings = undefined
  } catch {
    unsavedSettings = next
  }
  return next
}
