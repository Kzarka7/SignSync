const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')

function runRuntime(exportName, args, mediaPipe = {}) {
  const root = path.join(__dirname, '../src/services/landmarks')
  return hookHarness(path.join(root, 'visionRuntime.ts'), exportName, name =>
    name === '@mediapipe/tasks-vision' ? mediaPipe : load(path.resolve(root, name + '.ts')),
  () => args, { console: { warn() {} } }).render()
}

test('both delegates use a fixed two-hand tracker with 0.5 confidence thresholds by default', async () => {
  const calls = []
  const backend = { HandLandmarker: { async createFromOptions(_, options) {
    calls.push(options)
    if (calls.length === 1) throw Error('GPU unavailable')
    return {}
  } } }
  await runRuntime('createHandLandmarker', [{}, () => {}], backend)
  assert.deepEqual(calls.map(options => [
    options.baseOptions.delegate, options.minHandPresenceConfidence, options.minTrackingConfidence,
    options.minHandDetectionConfidence, options.numHands,
  ]), [['GPU', 0.5, 0.5, 0.5, 2], ['CPU', 0.5, 0.5, 0.5, 2]])
})

test('a CPU preference creates the hand tracker on the CPU without trying the GPU', async () => {
  const delegates = [], reports = []
  const backend = { HandLandmarker: { async createFromOptions(_, options) {
    delegates.push(options.baseOptions.delegate)
    return {}
  } } }
  await runRuntime('createHandLandmarker', [{}, delegate => reports.push(delegate), 'CPU'], backend)
  assert.deepEqual(delegates, ['CPU'])
  assert.deepEqual(reports, ['CPU'])
})
