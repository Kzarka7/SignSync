const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const model = 'p4-sign-rest-idle-nine-run-ensemble-graph-diagnostics'
const readyStatus = { type: 'status', payload: { state: 'ready', recognizerId: model,
  execution: 'graph', diagnosticsProtocol: 1, runs: ['member'] } }

function setup(mode = 'p4-candidate') {
  const socket = { endpoint: 'ws://localhost:8000/ws/translate?model=p4-candidate&diagnostics=1',
    disconnects: 0, connect(fn) { this.emit = fn }, disconnect() { this.disconnects++ }, sendSign() { return true } }
  const timers = new Map(); let counter = 0
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync('src/services/ws/diagnosticPredictor.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(code, { exports, URL, require: () => ({ createTranslationSocket(selected, diagnostics) {
    assert.equal(selected, mode); assert.equal(diagnostics, true); return socket
  } }), setTimeout(callback) { timers.set(++counter, callback); return counter }, clearTimeout(id) { timers.delete(id) } })
  return { client: exports.createDiagnosticPredictor(mode), socket, timers }
}

test('lab selections verify their own checkpoint identity and reject the other model', async () => {
  for (const [mode, identity, otherModel] of [
    ['lab-grouped', 'lab-grouped-seed42-graph-diagnostics', model],
    ['lab-clip', 'lab-clip-seed42-graph-diagnostics', model],
    ['lab-signs38', 'lab-signs38-seed42-graph-diagnostics', 'lab-clip-seed42-graph-diagnostics'],
    ['lab-signs38-clip', 'lab-signs38-clip-seed42-graph-diagnostics', 'lab-signs38-seed42-graph-diagnostics'],
    ['lab-signs33', 'lab-signs33-seed42-graph-diagnostics', 'lab-signs38-clip-seed42-graph-diagnostics'],
    ['lab-signs43-numbers', 'lab-signs43-numbers-seed42-graph-diagnostics', 'lab-signs33-seed42-graph-diagnostics'],
    ['lab-signs43-shape-motion', 'lab-signs43-shape-motion-seed42-graph-diagnostics', 'lab-signs43-numbers-seed42-graph-diagnostics'],
    ['lab-signs43-similarity', 'lab-signs43-similarity-seed42-graph-diagnostics', 'lab-signs43-shape-motion-seed42-graph-diagnostics'],
    ['lab-signs43-similarity-v2', 'lab-signs43-similarity-v2-seed42-graph-diagnostics', 'lab-signs43-similarity-seed42-graph-diagnostics'],
    // The motion E candidate must not accept the v1 baseline checkpoint.
    ['lab-signs43-motion-e', 'lab-signs43-motion-e-seed42-graph-diagnostics', 'lab-signs43-similarity-seed42-graph-diagnostics'],
    ['lab-signs75-multi-batch', 'lab-signs75-multi-batch-seed42-graph-diagnostics', 'lab-signs43-similarity-seed42-graph-diagnostics'],
    ['lab-signs32-standalone', 'lab-signs32-standalone-v3-seed42-graph-diagnostics', 'lab-signs32-standalone-v2-seed42-graph-diagnostics'],
    // v4 must not accept the v3 checkpoint (and vice versa above).
    ['lab-signs32-standalone-v4', 'lab-signs32-standalone-v4-seed42-graph-diagnostics', 'lab-signs32-standalone-v3-seed42-graph-diagnostics'],
    ['lab-signs32-standalone-v5', 'lab-signs32-standalone-v5-seed42-graph-diagnostics', 'lab-signs32-standalone-v4-seed42-graph-diagnostics'],
    // The motion retrain must not accept the plain v5 checkpoint.
    ['lab-signs32-standalone-v5-motion', 'lab-signs32-standalone-v5-motion-seed42-graph-diagnostics', 'lab-signs32-standalone-v5-seed42-graph-diagnostics'],
    ['lab-signs74-combined', 'lab-signs74-combined-v3-seed42-graph-diagnostics', 'lab-signs74-combined-v1-seed42-graph-diagnostics'],
    ['lab-ix-poss-pilot', 'lab-ix-poss-pilot-seed42-graph-diagnostics', 'lab-signs32-standalone-v3-seed42-graph-diagnostics'],
    ['lab-ix-poss-motion', 'lab-ix-poss-motion-seed42-graph-diagnostics', 'lab-ix-poss-pilot-seed42-graph-diagnostics'],
    ['lab-alphabet', 'lab-alphabet-j460-v2-seed43-graph-diagnostics', model],
    ['lab-stage2', 'lab-stage2-rerun-20261109-seeds42-43-44-no-hold-graph-diagnostics',
      'lab-stage2-rerun-20261109-seeds42-43-44-graph-diagnostics'],
  ]) {
    const { client, socket } = setup(mode)
    const loading = client.connect()
    socket.emit({ type: 'status', payload: { ...readyStatus.payload, recognizerId: identity } })
    const info = await loading
    assert.equal(new URL(info.endpoint).searchParams.get('model'), mode)
    const response = client.predict({ requestId: 'one' })
    const rejected = assert.rejects(response, /unverified recognizer/)
    socket.emit({ type: 'prediction', payload: { requestId: 'one', model: otherModel } })
    await rejected
  }
})

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
  for (const [mode, payload] of [
    ['p4-candidate', { state: 'ready' }],
    ['p4-candidate', { ...readyStatus.payload, recognizerId: 'p4-sign-rest-idle-nine-run-ensemble' }],
    ['p4-candidate', { ...readyStatus.payload, diagnosticsProtocol: 0 }],
    ['p4-candidate', { ...readyStatus.payload, execution: 'eager' }],
    ['lab-signs32-standalone', { ...readyStatus.payload, recognizerId: 'lab-signs32-standalone-v2-seed42-graph-diagnostics' }],
  ]) {
    const { client, socket, timers } = setup(mode), loading = client.connect()
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
