import { TranscriptUpdate } from '../../types/speech'

// Decoupled from VITE_USE_MOCKS on purpose: speech recognition is a
// browser capability, not a backend call, so it has its own flag. Defaults
// to "false" (use the real Web Speech API) now that a real implementation
// exists - flip VITE_USE_MOCK_SPEECH=true to fall back to the scripted
// demo words, e.g. when testing on a browser without mic access.
const USE_MOCK_SPEECH = (import.meta.env.VITE_USE_MOCK_SPEECH ?? 'false') === 'true'

// The contract AvatarPanel/useSpeechRecognition depends on.
export interface ISpeechRecognitionService {
  start(onUpdate: (update: TranscriptUpdate) => void, onError?: (message: string) => void): void
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

// Real implementation: wraps the browser's native Web Speech API
// (SpeechRecognition / webkitSpeechRecognition). Supported in Chrome and
// Edge; not supported in Firefox or Safari as of this writing - callers
// get a clear onError message in that case instead of a silent failure.
class RealSpeechRecognitionService implements ISpeechRecognitionService {
  private recognition: SpeechRecognitionLike | null = null
  private finalTranscript = ''
  private manuallyStopped = false

  start(onUpdate: (update: TranscriptUpdate) => void, onError?: (message: string) => void) {
    const SpeechRecognitionCtor = window.SpeechRecognition ?? window.webkitSpeechRecognition

    if (!SpeechRecognitionCtor) {
      onError?.('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    this.finalTranscript = ''
    this.manuallyStopped = false

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US' // swap to 'fil-PH' if/when the browser's engine supports it well

    recognition.onresult = (event) => {
      let interimTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          this.finalTranscript += `${result[0].transcript} `
        } else {
          interimTranscript += result[0].transcript
        }
      }

      const combined = `${this.finalTranscript}${interimTranscript}`.trim()
      onUpdate({ text: combined, isFinal: interimTranscript === '' && this.finalTranscript !== '' })
    }

    recognition.onerror = (event) => {
      // "no-speech" fires often and isn't worth surfacing as an error -
      // it just means the engine paused during silence, onend below
      // handles restarting it.
      if (event.error !== 'no-speech') {
        onError?.(`Speech recognition error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      // Some browsers stop the engine after a pause even with
      // continuous = true. Restart automatically unless the user
      // actually pressed stop.
      if (!this.manuallyStopped) {
        recognition.start()
      }
    }

    this.recognition = recognition
    recognition.start()
  }

  stop() {
    this.manuallyStopped = true
    this.recognition?.stop()
    this.recognition = null
  }
}

export function createSpeechRecognitionService(): ISpeechRecognitionService {
  return USE_MOCK_SPEECH ? new MockSpeechRecognitionService() : new RealSpeechRecognitionService()
}
