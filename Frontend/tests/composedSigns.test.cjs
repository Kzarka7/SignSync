const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { appendComposed, COMPOSITION_MAX_GAP_MS } = load(path.resolve('src/services/landmarks/composedSigns.ts'))
const { COMPOSING_MODELS } = load(path.resolve('src/services/landmarks/recognitionDiagnostics.ts'))

const entry = (label, decisionMs, score = .9) => ({ label, score, decisionMs, requestId: `${label}-${decisionMs}` })

test('FATHER then MOTHER becomes one PARENTS entry', () => {
  const transcript = [entry('HELLO', 0)]
  assert.equal(appendComposed(transcript, entry('FATHER', 1000, .95)), false)
  assert.equal(appendComposed(transcript, entry('MOTHER', 2400, .8)), true)
  assert.deepEqual(transcript.map(e => e.label), ['HELLO', 'PARENTS'])
  assert.equal(transcript[1].score, .8)
  assert.deepEqual([...transcript[1].composedFrom.map(e => e.label)], ['FATHER', 'MOTHER'])
})

test('MOTHER then FATHER also becomes PARENTS', () => {
  const transcript = []
  appendComposed(transcript, entry('MOTHER', 0))
  appendComposed(transcript, entry('FATHER', 1500))
  assert.deepEqual(transcript.map(e => e.label), ['PARENTS'])
})

test('single parts, distant parts, and repeats stay separate', () => {
  const transcript = []
  appendComposed(transcript, entry('FATHER', 0))
  appendComposed(transcript, entry('GOOD', 800))
  appendComposed(transcript, entry('MOTHER', 1600))
  appendComposed(transcript, entry('FATHER', 1600 + COMPOSITION_MAX_GAP_MS + 1))
  appendComposed(transcript, entry('FATHER', 9000))
  assert.deepEqual(transcript.map(e => e.label), ['FATHER', 'GOOD', 'MOTHER', 'FATHER', 'FATHER'])
})

test('a composed sign is not reused as a part', () => {
  const transcript = []
  appendComposed(transcript, entry('FATHER', 0))
  appendComposed(transcript, entry('MOTHER', 1000))
  appendComposed(transcript, entry('FATHER', 2000))
  assert.deepEqual(transcript.map(e => e.label), ['PARENTS', 'FATHER'])
})

test('only the combined model composes', () => {
  assert.equal(COMPOSING_MODELS.has('lab-signs74-combined'), true)
  assert.equal(COMPOSING_MODELS.has('lab-signs32-standalone'), false)
})
