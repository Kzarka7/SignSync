const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('../scripts/loadTypeScript.cjs')
const { mostPredictedSign } = load('src/services/landmarks/queueReview.ts')
const row = label => ({ prediction: { label, score: .1, accepted: false } })
test('queue fallback counts low confidence predictions and ignores missing predictions', () => {
  assert.equal(mostPredictedSign([row('HELLO'), row('HAPPY'), { prediction: null }, row('HAPPY')]), 'HAPPY')
  assert.equal(mostPredictedSign([]), undefined)
})
test('queue fallback ties keep the first label seen, independent of when counts catch up', () => {
  assert.equal(mostPredictedSign([row('HELLO'), row('HAPPY'), row('HAPPY'), row('HELLO')]), 'HELLO')
})

const { queueSignSummary } = load('src/services/landmarks/queueReview.ts')
const display = label => label.replaceAll('_', ' ')
test('export and queue share confirmed labels with repeated signs preserved', () => {
  const result = queueSignSummary({ transcript: [{ label: 'THANK_YOU' }, { label: 'THANK_YOU' }], rows: [row('HELLO'), row('HELLO')] }, display)
  assert.equal(result.displayedText, 'THANK YOU → THANK YOU')
  assert.equal(result.confirmed, true)
  assert.deepEqual(result.labels, ['THANK_YOU', 'THANK_YOU'])
  assert.equal(result.source, 'confirmed-transcript')
  assert.equal(result.totalPredictionWindows, 2)
})
test('unconfirmed and unprocessed exports match queue text without implying confirmation', () => {
  const result = queueSignSummary({ transcript: [], rows: [row('HELLO'), row('HAPPY'), row('HAPPY')] }, display)
  assert.equal(result.displayedText, 'HAPPY')
  assert.equal(result.confirmed, false)
  assert.equal(result.source, 'prediction-window-vote')
  assert.deepEqual(JSON.parse(JSON.stringify(result.predictionWindowCounts)), [{ label: 'HELLO', count: 1 }, { label: 'HAPPY', count: 2 }])
  assert.equal(queueSignSummary(undefined, display).displayedText, '—')
  assert.equal(queueSignSummary(undefined, display).source, 'none')
})

