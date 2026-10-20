const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function setup(mode, diagnostics = false) {
  class Socket {
    static OPEN = 1
    readyState = 0
    bufferedAmount = 0
    sent = []
    constructor(url) { this.url = String(url); Socket.latest = this }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3 }
  }
  const source = fs.readFileSync('src/services/ws/translationSocket.ts', 'utf8')
    .replaceAll('import.meta.env', '({})')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const context = { exports: {}, WebSocket: Socket, URL, console }
  vm.runInNewContext(code, context)
  const transport = context.exports.createTranslationSocket(mode, diagnostics)
  const events = []
  transport.connect(event => events.push(event))
  return { transport, socket: Socket.latest, events }
}

test('closed or backlogged sockets reject a recording without sending it', () => {
  const { transport, socket } = setup()
  assert.equal(transport.sendSign({ requestId: 'one' }), false)
  transport.sendControl('end-session')
  assert.equal(socket.sent.length, 0)
  socket.readyState = 1
  socket.bufferedAmount = 10
  assert.equal(transport.sendSign({ requestId: 'one' }), false)
  socket.bufferedAmount = 0
  assert.equal(transport.sendSign({ requestId: 'one' }), true)
  assert.equal(socket.sent[0].type, 'sign')
  assert.equal(socket.sent[0].payload.requestId, 'one')
})

test('prediction delivery, malformed response, and disconnection are visible', () => {
  const { socket, events } = setup()
  socket.onmessage({ data: JSON.stringify({ type: 'prediction', payload: { label: 'HELLO' } }) })
  assert.equal(events[0].payload.label, 'HELLO')
  socket.onmessage({ data: 'invalid json' })
  assert.equal(events[1].type, 'error')
  socket.onclose()
  assert.equal(events[2].payload.state, 'disconnected')
})

test('cleanup removes handlers so old sockets cannot update the next session', () => {
  const { transport, socket } = setup()
  transport.disconnect()
  assert.equal(socket.onmessage, null)
  assert.equal(socket.onclose, null)
  assert.equal(socket.onerror, null)
  assert.equal(transport.sendSign({ requestId: 'stale' }), false)
})

 test('model selection is explicit and defaults to v5', () => {
  assert.equal(new URL(setup().socket.url).searchParams.get('model'), 'v5')
  assert.equal(new URL(setup('p4-candidate').socket.url).searchParams.get('model'), 'p4-candidate')
})

test('graph execution is opt-in only for the diagnostic connection', () => {
  assert.equal(new URL(setup('p4-candidate').socket.url).searchParams.get('diagnostics'), null)
  assert.equal(new URL(setup().socket.url).searchParams.get('diagnostics'), null)
  assert.equal(new URL(setup('p4-candidate', true).socket.url).searchParams.get('diagnostics'), '1')
})
