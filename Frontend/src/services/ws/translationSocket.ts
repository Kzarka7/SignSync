import { TranslationSocketEvent, SignRequest, RecognitionMode } from '../../types/message'

export interface ITranslationSocket {
  readonly endpoint?: string
  connect(onEvent: (event: TranslationSocketEvent) => void): void
  disconnect(): void
  sendControl(action: 'end-session' | 'export'): void
  sendSign(request: SignRequest): boolean
}

class RealTranslationSocket implements ITranslationSocket {
  constructor(private mode: RecognitionMode = 'v5', private diagnostics = false) {}
  private socket: WebSocket | null = null

  get endpoint() {
    const url = new URL(import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws/translate')
    url.searchParams.set('model', this.mode)
    if (this.diagnostics) url.searchParams.set('diagnostics', '1')
    return url.toString()
  }

  connect(onEvent: (event: TranslationSocketEvent) => void) {
    const socket = new WebSocket(this.endpoint)
    this.socket = socket
    socket.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data) as TranslationSocketEvent)
      } catch {
        onEvent({ type: 'error', payload: { message: 'Invalid recognition response. Reconnect and try again.' } })
      }
    }
    socket.onerror = () => onEvent({ type: 'error', payload: { message: 'Cannot reach recognition. Start the live backend, then reconnect.' } })
    socket.onclose = () => onEvent({ type: 'status', payload: { state: 'disconnected', message: 'Recognition disconnected' } })
  }

  disconnect() {
    if (this.socket) {
      this.socket.onmessage = null
      this.socket.onerror = null
      this.socket.onclose = null
      this.socket.close()
    }
    this.socket = null
  }

  sendControl(action: 'end-session' | 'export') {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'control', action }))
    }
  }

  sendSign(request: SignRequest): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN || this.socket.bufferedAmount > 0) return false
    this.socket.send(JSON.stringify({ type: 'sign', payload: request }))
    return true
  }
}

// Recognition always uses the real backend, independently of dashboard mocks.
export function createTranslationSocket(mode: RecognitionMode = 'v5', diagnostics = false): ITranslationSocket {
  return new RealTranslationSocket(mode, diagnostics)
}
