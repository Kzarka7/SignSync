const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { assessNumberHold } = load(path.resolve('src/services/landmarks/numberHold.ts'))
const { createDiagnosticSession } = load(path.resolve('src/services/landmarks/recognitionDiagnostics.ts'))

function frame(timestamp, x = 0) {
  const features = Array(164).fill(0)
  features[7] = features[11] = features[36] = 1
  for (let joint = 0; joint < 21; joint++) features[37 + joint * 3] = x + joint * .01
  return { timestamp, valid: true, features }
}
function prediction(label, accepted = true) {
  return { label, accepted, score: .99, top3: [{ label, score: .99 }], requestId: 'test', model: 'test', inferenceMs: 1, frameCount: 11 }
}
const frames = motion => Array.from({ length: 11 }, (_, i) => frame(i * 50, motion(i * 50)))

test('stable numbers tolerate small jitter but moving numbers wait', () => {
  const quiet = frames(t => Math.sin(t) * .003)
  assert.equal(assessNumberHold(quiet, prediction('SIX')).blocked, false)
  assert.equal(assessNumberHold(frames(t => t * .0004), prediction('SIX')).blocked, true)
  assert.equal(assessNumberHold(quiet.slice(0, 7), prediction('SIX')).blocked, true)
})

test('confusing signs require observed movement and finger movement counts', () => {
  assert.equal(assessNumberHold(frames(() => 0), prediction('WEDNESDAY')).blocked, true)
  const moving = frames(t => t * .0004)
  assert.equal(assessNumberHold(moving, prediction('WEDNESDAY')).blocked, false)
  const fingers = frames(() => 0)
  for (let i = 0; i < fingers.length; i++) {
    for (let joint = 1; joint < 21; joint++) fingers[i].features[38 + joint * 3] = i * .02
  }
  assert.equal(assessNumberHold(fingers, prediction('NO')).motionObserved, true)
})

test('tracking gaps, lost hands, invalid pose and nonfinite landmarks cannot establish a hold', () => {
  for (const change of [
    f => { f[5].valid = false },
    f => { f[5].features[36] = 0 },
    f => { f[5].features[7] = 0 },
    f => { f[5].features[40] = NaN },
    f => { f[5].timestamp = f[4].timestamp },
  ]) {
    const input = frames(() => 0)
    change(input)
    assert.equal(assessNumberHold(input, prediction('TWO')).reason, 'hold_tracking_incomplete')
  }
  const gap = frames(() => 0).filter(f => f.timestamp < 150 || f.timestamp > 350)
  assert.equal(assessNumberHold(gap, prediction('TWO')).blocked, true)
  assert.equal(assessNumberHold([], prediction('TWO')).blocked, true)
  assert.equal(assessNumberHold(frames(() => 0), prediction('REST')), null)
})

test('the diagnostic path accepts a stationary number once and preserves model rejection', async () => {
  for (const accepted of [true, false]) {
    const session = createDiagnosticSession({ source: 'video', name: 'hold', recognitionMode: 'rolling',
      numberHoldExperiment: true, onChange() {}, now: () => 0,
      settings: { windowMs: 600, strideMs: 100, confirmationWindows: 2, confirmationHistory: 3, confirmationMs: 100 },
      predict: async request => ({ ...prediction('SIX', accepted), requestId: request.requestId }), id: () => 'hold',
    })
    for (let t = 0; t <= 2000; t += 50) await session.observeFeatures(frame(t, Math.sin(t) * .002))
    assert.equal(session.state.transcript.length, accepted ? 1 : 0)
    assert.ok(session.report().rows.every(row => row.numberHold.label === 'SIX'))
    assert.equal(session.report().numberHoldExperiment.holdMs, 500)
  }
})

test('a static NO stays uncertain and is never relabeled as a number', async () => {
  const session = createDiagnosticSession({ source: 'video', name: 'ambiguous', recognitionMode: 'rolling',
    numberHoldExperiment: true, onChange() {}, now: () => 0, id: () => 'no',
    predict: async request => ({ ...prediction('NO'), requestId: request.requestId }),
  })
  for (let t = 0; t <= 2500; t += 50) await session.observeFeatures(frame(t))
  assert.equal(session.state.transcript.length, 0)
  assert.ok(session.state.rows.every(row => row.prediction.label === 'NO' && row.numberHold.blocked))
})
