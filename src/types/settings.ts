export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
  interfaceLanguage: 'en' | 'fil'
  voice: string
  highContrast: boolean
  largeText: boolean
  avatarSpeed: 0.75 | 1 | 1.25
  autoSaveConversations: boolean
}
