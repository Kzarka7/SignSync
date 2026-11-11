import { createTranslationSocket } from './translationSocket'
import type { SignPrediction, SignRequest, LiveDiagnosticMode } from '../../types/message'

export const DIAGNOSTIC_RECOGNIZER_ID = 'p4-sign-rest-idle-nine-run-ensemble-graph-diagnostics'
export type DiagnosticBackendInfo = {
  recognizerId: string; execution: 'graph'; protocol: 1; endpoint: string; runs: string[]; verifiedAt: string
  supportsShortPreview: boolean
}

// A dedicated candidate-only connection prevents raw overlapping predictions
// from entering useTranslationStream's automatic conversation transcript.
export function createDiagnosticPredictor(mode: LiveDiagnosticMode | 'p4-candidate' = 'p4-candidate') {
  const recognizerId = mode === 'p4-candidate' ? DIAGNOSTIC_RECOGNIZER_ID
    : mode === 'lab-alphabet' ? 'lab-alphabet-j460-v2-seed43-graph-diagnostics'
    : `${mode}-seed42-graph-diagnostics`
  const socket = createTranslationSocket(mode, true)
  let pending: { id: string; resolve: (value: SignPrediction) => void; reject: (error: Error) => void } | null = null
  let ready = false, closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let rejectConnection: ((error: Error) => void) | null = null
  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null }
  const fail = (message: string) => {
    clearTimer(); ready = false
    const error = Error(message)
    rejectConnection?.(error); rejectConnection = null
    pending?.reject(error); pending = null
    socket.disconnect(); closed = true
  }
  return {
    connect() {
      return new Promise<DiagnosticBackendInfo>((resolve, reject) => {
        if (closed) { reject(Error('Diagnostics connection closed. Start a new run.')); return }
        rejectConnection = reject
        timer = setTimeout(() => fail('Candidate loading timed out. Check the backend and start a new run.'), 120000)
        socket.connect(event => {
          if (closed) return
          if (event.type === 'status') {
            if (event.payload.state === 'ready') {
              const info = event.payload
              if (info.diagnosticsProtocol !== 1 || info.execution !== 'graph' || info.recognizerId !== recognizerId) {
                fail('Backend mismatch: recognition requires graph-diagnostics v1. Restart the SignSync backend at the configured address and reload this page.'); return
              }
              let endpoint = 'Configured recognition backend'
              if (socket.endpoint) {
                const url = new URL(socket.endpoint)
                url.username = ''; url.password = ''; url.search = ''; url.hash = ''
                url.searchParams.set('model', mode); url.searchParams.set('diagnostics', '1')
                endpoint = url.toString()
              }
              ready = true; clearTimer(); rejectConnection = null
              resolve({ recognizerId: info.recognizerId, execution: 'graph', protocol: 1,
                endpoint, runs: info.runs ?? [], verifiedAt: new Date().toISOString(), supportsShortPreview: info.supportsShortPreview === true })
            }
            else if (event.payload.state === 'disconnected') fail('Candidate disconnected. Start a new run.')
          } else if (event.type === 'error') fail(event.payload.message)
          else if (event.type === 'prediction' && pending?.id === event.payload.requestId) {
            if (event.payload.model !== recognizerId) {
              fail('Backend mismatch: received a prediction from an unverified recognizer. Restart the SignSync backend and start a new run.'); return
            }
            clearTimer(); const work = pending; pending = null; work.resolve(event.payload)
          }
        })
      })
    },
    predict(request: SignRequest) {
      return new Promise<SignPrediction>((resolve, reject) => {
        if (!ready || closed || pending) { reject(Error('Candidate is not ready for a diagnostic window.')); return }
        pending = { id: request.requestId, resolve, reject }
        if (!socket.sendSign(request)) { fail('Could not send diagnostic window. Start a new run.'); return }
        timer = setTimeout(() => fail('Diagnostic inference timed out. Start a new run.'), 30000)
      })
    },
    close() { fail('Diagnostics stopped') },
  }
}
