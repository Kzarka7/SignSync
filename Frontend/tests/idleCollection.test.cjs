const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const api = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,
  '../src/services/dataset/idleCollection.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: api })

test('idle has nine variations of one label without requiring participant/session identity', () => {
  assert.equal(new Set(api.IDLE_VARIATIONS.map(v => v.id)).size, 9)
  assert.equal(api.IDLE_LABEL, 'IDLE')
  assert.equal(api.createIdleMetadata('HELLO'), undefined)
  for (const variation of api.IDLE_VARIATIONS) {
    const metadata = api.createIdleMetadata(variation.id)
    assert.equal(metadata.hands, variation.hands)
    assert.equal(metadata.posture, variation.posture)
    assert.equal(Object.hasOwn(metadata, 'participantId'), false)
    assert.equal(Object.hasOwn(metadata, 'sessionId'), false)
  }
})

test('legacy idle labels normalize without mutating samples or losing identity/variation', () => {
  const collection = { ...api.createIdleMetadata('IDLE_LEFT_NEAR_WAIST'), participantId: 'participant_01', sessionId: 'session-01' }
  const sample = { id: 'legacy', label: 'IDLE_LEFT_NEAR_WAIST', frames: [], collection }
  const normalized = api.normalizeIdleSequence(sample)
  assert.equal(normalized.label, 'IDLE')
  assert.equal(normalized.collection, collection)
  assert.equal(normalized.frames, sample.frames)
  assert.equal(sample.label, 'IDLE_LEFT_NEAR_WAIST')
  const inferred = api.normalizeIdleSequence({ label: 'IDLE_BOTH_IN_FRONT', frames: [] })
  assert.equal(inferred.collection.hands, 'both')
  assert.equal(inferred.collection.posture, 'in_front')
  assert.equal(api.normalizeIdleSequence(normalized), normalized)
  for (const label of ['HELLO', 'THANK_YOU', 'IDLE_UNRECOGNIZED']) {
    const sign = { label, frames: [] }
    assert.equal(api.normalizeIdleSequence(sign), sign)
  }
})

test('new idle clips carry no guessed variation annotations', () => {
  const metadata = api.createIdleMetadata()
  assert.equal(metadata.kind, 'idle')
  assert.equal(metadata.targetDurationMs, 3000)
  for (const field of ['hands', 'posture', 'palmOrientation', 'participantId', 'sessionId']) {
    assert.equal(Object.hasOwn(metadata, field), false)
  }
  const sample = { label: 'IDLE', frames: [], collection: metadata }
  assert.equal(api.normalizeIdleSequence(sample), sample)
})
