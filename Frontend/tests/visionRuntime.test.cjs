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

test('Lab hand thresholds apply to both delegates and other callers keep the default', async () => {
  const calls = []
  const backend = { HandLandmarker: { async createFromOptions(_, options) {
    calls.push(options)
    if (calls.length === 1) throw Error('GPU unavailable')
    return {}
  } } }
  await runRuntime('createHandLandmarker', [{}, () => {}, true, 1], backend)
  await runRuntime('createHandLandmarker', [{}, () => {}], backend)
  assert.deepEqual(calls.map(options => [
    options.baseOptions.delegate, options.minHandPresenceConfidence, options.minTrackingConfidence,
    options.minHandDetectionConfidence, options.numHands,
  ]), [['GPU', 0.25, 0.30, 0.45, 1], ['CPU', 0.25, 0.30, 0.45, 1], ['GPU', 0.5, 0.5, 0.5, 2]])
})

test('hand capacity requires consecutive observations and clears uncertainty', () => {
  const capacity = runRuntime('createHandCapacityController', [])
  for (let i = 0; i < 8; i++) capacity.observe(1)
  capacity.observe(0)
  capacity.observe(1)
  assert.equal(capacity.limit, 2, 'a rest frame breaks the one-hand streak')
  for (let i = 0; i < 8; i++) capacity.observe(1)
  assert.equal(capacity.limit, 1)
  capacity.observe(2)
  capacity.observe(2)
  capacity.observe(1)
  capacity.observe(2)
  capacity.observe(2)
  assert.equal(capacity.limit, 1, 'one wrist breaks the two-hand streak')
  capacity.observe(2)
  assert.equal(capacity.limit, 2)
  for (let i = 0; i < 9; i++) capacity.observe(1)
  assert.equal(capacity.limit, 1)
  capacity.observe(null)
  assert.equal(capacity.limit, 2)
})

test('Lab wrist filtering uses projected shoulder width and keeps hand results aligned', () => {
  const point = (x, y, visibility = 1) => ({ x, y, z: 0, visibility })
  const body = []
  body[11] = point(0.5, 0.25)
  body[12] = point(0.5, 0.75)
  body[15] = point(0.25, 0.5)
  body[16] = point(0.75, 0.5, 0.5)
  const hands = [[point(0.325, 0.5)], [point(0.75, 0.5)], [point(0.25, 0.625)]]
  const world = [[point(0, 0)], [point(1, 0)], [point(2, 0)]]
  const sides = [[{ categoryName: 'Left' }], [{ categoryName: 'Left' }], [{ categoryName: 'Right' }]]
  const result = { landmarks: hands, worldLandmarks: world, handedness: sides, handednesses: sides }
  const filtered = () => runRuntime('filterHandsByPoseWrist', [result, { landmarks: [body] }, 2])
  const matched = filtered()
  assert.equal(matched.landmarks.length, 1)
  assert.equal(matched.landmarks[0], hands[2], 'a wrist 0.25 shoulder widths away is retained')
  assert.equal(matched.worldLandmarks[0], world[2])
  assert.equal(matched.handedness[0], sides[2])
  assert.equal(matched.handednesses, matched.handedness)
  assert.equal(result.landmarks.length, 3)

  body[16].visibility = 1
  assert.equal(filtered().landmarks.length, 2)
  body[15].visibility = body[16].visibility = 0
  assert.equal(filtered(), result, 'a frame with no visible wrists cannot validate proximity')
  body[15].visibility = 1
  body[12].visibility = 0
  assert.equal(filtered(), result, 'a frame without reliable shoulder width cannot validate proximity')
  assert.equal(runRuntime('filterHandsByPoseWrist', [result, null, 2]), result)
})
