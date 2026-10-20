const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const model = 'p4-sign-rest-idle-nine-run-ensemble-graph-diagnostics'
const readyStatus = { type: 'status', payload: { state: 'ready', recognizerId: model,
  execution: 'graph', diagnosticsProtocol: 1, runs: ['member'] } }

function setup() {
  const socket = { endpoint: 'ws://localhost:8000/ws/translate?model=p4-candidate&diagnostics=1',
    disconnects: 0, connect(fn) { this.emit = fn }, disconnect() { this.disconnects++ }, sendSign() { return true } }
  const timers = new Map(); let counter = 0
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync('src/services/ws/diagnosticPredictor.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, { exports, URL, require: () => ({ createTranslationSocket(mode, diagnostics) {
    assert.equal(mode, 'p4-candidate'); assert.equal(diagnostics, true); return socket
  } }), setTimeout(callback) { timers.set(++counter, callback); return counter }, clearTimeout(id) { timers.delete(id) } })
  return { client: exports.createDiagnosticPredictor(), socket, timers }
}

test('diagnostic transport correlates responses and rejects pending work on stop', async () => {
  const { client, socket, timers } = setup()
  const connected = client.connect()
  socket.emit(readyStatus)
  const identity = await connected
  assert.equal(identity.recognizerId, model)
  assert.equal(identity.protocol, 1)
  assert.equal(identity.endpoint, socket.endpoint)
  assert.equal(timers.size, 0)
  const result = client.predict({ requestId: 'first' })
  socket.emit({ type: 'prediction', payload: { requestId: 'unsolicited', label: 'WHO' } })
  assert.equal(timers.size, 1)
  socket.emit({ type: 'prediction', payload: { requestId: 'first', label: 'REST', model } })
  assert.equal((await result).label, 'REST')
  const pending = client.predict({ requestId: 'second' })
  const rejected = assert.rejects(pending, /stopped/)
  client.close(); await rejected
  socket.emit({ type: 'prediction', payload: { requestId: 'second', label: 'WHO' } })
  assert.equal(timers.size, 0)
  await assert.rejects(client.predict({ requestId: 'third' }), /not ready/)
})

test('load failures and inference timeouts reject work and close the connection', async () => {
  const loading = setup(), connected = loading.client.connect()
  const rejected = assert.rejects(connected, /missing candidate/)
  loading.socket.emit({ type: 'error', payload: { message: 'missing candidate' } }); await rejected
  assert.equal(loading.socket.disconnects, 1)
  assert.equal(loading.timers.size, 0)
  const active = setup(), ready = active.client.connect()
  active.socket.emit(readyStatus); await ready
  const inference = active.client.predict({ requestId: 'first' })
  const timeout = assert.rejects(inference, /timed out/)
  Array.from(active.timers.values())[0](); await timeout
  assert.equal(active.socket.disconnects, 1)
  assert.equal(active.timers.size, 0)
})

test('old or mismatched backends fail before any prediction can be requested', async () => {
  for (const payload of [
    { state: 'ready' },
    { ...readyStatus.payload, recognizerId: 'p4-sign-rest-idle-nine-run-ensemble' },
    { ...readyStatus.payload, diagnosticsProtocol: 0 },
    { ...readyStatus.payload, execution: 'eager' },
  ]) {
    const { client, socket, timers } = setup(), loading = client.connect()
    const rejected = assert.rejects(loading, /Backend mismatch.*Restart/)
    socket.emit({ type: 'status', payload }); await rejected
    assert.equal(socket.disconnects, 1)
    assert.equal(timers.size, 0)
    await assert.rejects(client.predict({ requestId: 'blocked' }), /not ready/)
  }
})

test('a wrong prediction identity is rejected even after a valid handshake', async () => {
  const { client, socket } = setup(), loading = client.connect()
  socket.emit(readyStatus); await loading
  const response = client.predict({ requestId: 'first' })
  const rejected = assert.rejects(response, /unverified recognizer/)
  socket.emit({ type: 'prediction', payload: { requestId: 'first', label: 'WHO', model: 'old-backend' } })
  await rejected
  assert.equal(socket.disconnects, 1)
})
