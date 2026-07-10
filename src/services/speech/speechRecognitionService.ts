import { TranscriptUpdate } from '../../types/speech'
import { USE_MOCKS } from '../api/client'

// The contract AvatarPanel depends on. A real implementation wraps the
// Web Speech API (or a streamed backend transcript); the mock simulates
// one word arriving at a time so the subtitle container has something to
// render during development.
export interface ISpeechRecognitionService {
  start(onUpdate: (update: TranscriptUpdate) => void): void
  stop(): void
}

const MOCK_WORDS = ['Please', 'follow', 'me', 'to', 'the', 'triage', 'room.']

class MockSpeechRecognitionService implements ISpeechRecognitionService {
  private timer: ReturnType<typeof setInterval> | null = null
  private index = 0
  private accumulated = ''

  start(onUpdate: (update: TranscriptUpdate) => void) {
    this.index = 0
    this.accumulated = ''
    this.timer = setInterval(() => {
      if (this.index >= MOCK_WORDS.length) {
        this.stop()
        return
      }
      this.accumulated = `${this.accumulated} ${MOCK_WORDS[this.index]}`.trim()
      onUpdate({ text: this.accumulated, isFinal: false })
      this.index += 1
    }, 450)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

// Stub for the real integration. Swap in the Web Speech API
// (`webkitSpeechRecognition` / `SpeechRecognition`) here, or a streamed
// transcript pushed from the backend over the existing WebSocket - either
// way, call `onUpdate` with the same TranscriptUpdate shape.
class RealSpeechRecognitionService implements ISpeechRecognitionService {
  start(_onUpdate: (update: TranscriptUpdate) => void) {
    console.warn('RealSpeechRecognitionService not yet implemented - pending speech recognition integration')
  }
  stop() {}
}

export function createSpeechRecognitionService(): ISpeechRecognitionService {
  return USE_MOCKS ? new MockSpeechRecognitionService() : new RealSpeechRecognitionService()
}
