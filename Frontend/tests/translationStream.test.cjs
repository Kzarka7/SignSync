const { test } = require('node:test')
const assert = require('node:assert/strict')
const { hookHarness } = require('./helpers/hookHarness.cjs')
function setup(externalRecognition=false) {
  const sockets = []
  const harness = hookHarness('src/hooks/useTranslationStream.ts', 'useTranslationStream', name => {
    if (name.endsWith('/translationSocket')) return { createTranslationSocket: mode => {
      const socket = { mode, connect(fn) { this.emit = fn }, disconnect() {}, sendSign() { return true } }
      sockets.push(socket); return socket
    }}
    if (name.endsWith('/confidence')) return { averageConfidence: () => 99 }
    if (name.endsWith('/sessionStore')) return { useSessionStore: { getState: () => ({ sessionId: 'test' }) } }
    throw Error(name)
  },()=>[externalRecognition])
  harness.render()
  const ready = () => { sockets.at(-1).emit({ type: 'status', payload: { state: 'ready' } }); return harness.render() }
  const predict = (id, label, accepted, rejectionReason) => {
    assert.equal(harness.render().sendSign({ requestId: id }), true)
    sockets.at(-1).emit({ type: 'prediction', payload: { requestId: id, label, accepted, rejectionReason, score: .967, model: 'candidate' } })
    return harness.render()
  }
  return { harness, ready, predict, sockets }
}

test('external recognition opens no legacy socket and deduplicates confirmed entries',()=>{
  const {harness,sockets}=setup(true)
  assert.equal(sockets.length,0)
  const entry={requestId:'confirmed',label:'THANK_YOU',score:.967}
  harness.render().appendConfirmedSign(entry)
  harness.render().appendConfirmedSign(entry)
  harness.render().appendConfirmedSign({requestId:'rest',label:'REST',score:.99})
  assert.equal(harness.render().messages.length,1)
  assert.equal(harness.render().messages[0].text,'THANK YOU')
  assert.equal(harness.render().messages[0].confidence,96.7)
  harness.unmount()
})
test('candidate auto-transcribes separate accepted signs once, preserving repeats and percentages', () => {
  const { harness, ready, predict, sockets } = setup()
  harness.render().selectMode('p4-candidate'); harness.render(); ready()
  assert.equal(predict('first', 'HELLO', true).messages.length, 1)
  assert.equal(predict('rest', 'REST', false).messages.length, 1)
  assert.equal(predict('idle', 'IDLE_MOVEMENT', false).messages.length, 1)
  assert.equal(predict('blocked', 'WHAT', false, 'insufficient_hand_visibility').messages.length, 1)
  assert.equal(predict('uncertain', 'WHAT', false).messages.length, 1)
  const result = predict('second', 'HELLO', true)
  assert.equal(result.messages.length, 2)
  assert.equal(result.messages[0].text, 'HELLO')
  assert.equal(result.messages[1].text, 'HELLO')
  assert.equal(result.messages[0].confidence, 96.7)
  assert.notEqual(result.messages[0].id, result.messages[1].id)
  sockets.at(-1).emit({ type: 'prediction', payload: { requestId: 'second', label: 'HELLO', accepted: true, score: .967 } })
  assert.equal(harness.render().messages.length, 2)
  harness.unmount()
})
test('v5 stays manual and unsolicited responses cannot append', () => {
  const { harness, ready, predict, sockets } = setup()
  ready()
  assert.equal(predict('manual', 'HELLO', true).messages.length, 0)
  harness.render().addPrediction(); assert.equal(harness.render().messages.length, 1)
  harness.render().addPrediction(); assert.equal(harness.render().messages.length, 1)
  harness.render().selectMode('p4-candidate'); harness.render(); ready()
  sockets.at(-1).emit({ type: 'prediction', payload: { requestId: 'manual', label: 'HELLO', accepted: true, score: .99 } })
  assert.equal(harness.render().messages.length, 1)
  harness.unmount()
})
