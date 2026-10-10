const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function setup() {
  class Socket {
    static OPEN = 1
    readyState = 0
    bufferedAmount = 0
    sent = []
    constructor() { Socket.latest = this }
    send(data) { this.sent.push(JSON.parse(data)) }
    close() { this.readyState = 3 }
  }
  const source = fs.readFileSync('src/services/ws/translationSocket.ts', 'utf8')
    .replaceAll('import.meta.env', '({})')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const context = { exports: {}, WebSocket: Socket, console }
  vm.runInNewContext(code, context)
  const transport = context.exports.createTranslationSocket()
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
