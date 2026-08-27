import { TranslationSocketEvent } from '../../types/message'
import { USE_MOCKS } from '../api/client'
import mockMessages from '../../mocks/messages.json'
import { ConversationMessage } from '../../types/message'

// The contract every implementation of this interface must satisfy.
// Live Conversation components depend on this interface only - never on
// MockTranslationSocket or RealTranslationSocket directly - so swapping
// implementations requires no component changes.
export interface ITranslationSocket {
  connect(onEvent: (event: TranslationSocketEvent) => void): void
  disconnect(): void
  sendControl(action: 'end-session' | 'export'): void
}

// Emits the demo conversation on an interval, simulating a live stream of
// translated utterances arriving from the ML pipeline.
class MockTranslationSocket implements ITranslationSocket {
  private timer: ReturnType<typeof setInterval> | null = null
  private index = 0
  private queue = mockMessages as ConversationMessage[]

  connect(onEvent: (event: TranslationSocketEvent) => void) {
    this.timer = setInterval(() => {
      if (this.index >= this.queue.length) {
        this.index = 0 // loop the demo conversation
      }
      onEvent({ type: 'translation', payload: this.queue[this.index] })
      this.index += 1
    }, 4000)
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  sendControl(action: 'end-session' | 'export') {
    console.log(`[mock socket] control action received: ${action}`)
  }
}

// Stub for the real integration. Once the FastAPI WebSocket endpoint
// (see .env.example VITE_WS_URL) exists, this becomes the live path -
// no consuming component needs to change.
class RealTranslationSocket implements ITranslationSocket {
  private socket: WebSocket | null = null

  connect(onEvent: (event: TranslationSocketEvent) => void) {
    const url = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/translate'
    this.socket = new WebSocket(url)
    this.socket.onmessage = (msg) => {
      const parsed = JSON.parse(msg.data) as TranslationSocketEvent
      onEvent(parsed)
    }
  }

  disconnect() {
    this.socket?.close()
    this.socket = null
  }

  sendControl(action: 'end-session' | 'export') {
    this.socket?.send(JSON.stringify({ type: 'control', action }))
  }
}

export function createTranslationSocket(): ITranslationSocket {
  return USE_MOCKS ? new MockTranslationSocket() : new RealTranslationSocket()
}
