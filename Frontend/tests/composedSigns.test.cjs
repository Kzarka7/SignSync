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

const V4 = 'lab-signs74-motion-e-v4'

test('GRANDFATHER and GRANDMOTHER become GRANDPARENTS in either order on v4', () => {
  for (const [first, second] of [['GRANDFATHER', 'GRANDMOTHER'], ['GRANDMOTHER', 'GRANDFATHER']]) {
    const transcript = [entry('HELLO', 0)]
    assert.equal(appendComposed(transcript, entry(first, 1000, .9), undefined, V4), false)
    assert.equal(appendComposed(transcript, entry(second, 2500, .7), undefined, V4), true)
    assert.deepEqual(transcript.map(e => e.label), ['HELLO', 'GRANDPARENTS'])
    assert.equal(transcript[1].score, .7)
    assert.deepEqual([...transcript[1].composedFrom.map(e => e.label)], [first, second])
  }
})

test('GRANDPARENTS composes only for v4; PARENTS still composes everywhere', () => {
  for (const mode of [undefined, 'lab-signs74-motion-e-v2', 'lab-signs74-combined']) {
    const transcript = []
    appendComposed(transcript, entry('GRANDFATHER', 0), undefined, mode)
    appendComposed(transcript, entry('GRANDMOTHER', 1000), undefined, mode)
    appendComposed(transcript, entry('FATHER', 5000), undefined, mode)
    appendComposed(transcript, entry('MOTHER', 6000), undefined, mode)
    assert.deepEqual(transcript.map(e => e.label), ['GRANDFATHER', 'GRANDMOTHER', 'PARENTS'], String(mode))
  }
})

test('parts of different composed signs do not mix', () => {
  const transcript = []
  appendComposed(transcript, entry('FATHER', 0), undefined, V4)
  appendComposed(transcript, entry('GRANDMOTHER', 1000), undefined, V4)
  appendComposed(transcript, entry('GRANDFATHER', 1000 + COMPOSITION_MAX_GAP_MS + 1), undefined, V4)
  appendComposed(transcript, entry('GRANDFATHER', 6000), undefined, V4)
  assert.deepEqual(transcript.map(e => e.label), ['FATHER', 'GRANDMOTHER', 'GRANDFATHER', 'GRANDFATHER'])
})

test('only the combined models compose', () => {
  assert.equal(COMPOSING_MODELS.has('lab-signs74-combined'), true)
  assert.equal(COMPOSING_MODELS.has('lab-signs74-motion-e'), true)
  assert.equal(COMPOSING_MODELS.has('lab-signs43-motion-e'), false)
  assert.equal(COMPOSING_MODELS.has('lab-signs32-standalone'), false)
})
