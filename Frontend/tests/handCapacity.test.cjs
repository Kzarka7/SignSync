const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')

const root = path.join(__dirname, '../src')
const { createHandCapacityController } = load(path.join(root, 'services/landmarks/handCapacity.ts'))
const THRESHOLDS = { minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }

function drive(controller, counts) {
  const ran = []
  for (const count of counts) {
    const capacity = controller.next()
    ran.push(capacity)
    controller.observe(capacity, typeof count === 'function' ? count(capacity) : count)
  }
  return ran
}

test('one-hand model takes over after three single-hand frames and searches every third frame', () => {
  const controller = createHandCapacityController()
  assert.deepEqual(drive(controller, [1, 1, 1, 1, 1, 1, 1, 1, 1]), [2, 2, 2, 1, 1, 2, 1, 1, 2])
  assert.equal(controller.isSingle(), true)
})

test('a second hand found on a search frame, or a lost hand, returns to the two-hand model at once', () => {
  const controller = createHandCapacityController()
  drive(controller, [1, 1, 1])
  // Search frame (third after entering) sees two hands.
  assert.deepEqual(drive(controller, [1, 1, 2, 2]), [1, 1, 2, 2])
  assert.equal(controller.isSingle(), false)
  drive(controller, [1, 1, 1])
  assert.deepEqual(drive(controller, [0, 1]), [1, 2])
  assert.equal(controller.isSingle(), false)
})

test('no hands or two hands never enter one-hand mode, and the streak must be consecutive', () => {
  const controller = createHandCapacityController()
  assert.deepEqual(drive(controller, [0, 0, 2, 2, 1, 1, 0, 1, 1, 2]), [2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  assert.equal(controller.isSingle(), false)
})

function cameraHarness(options) {
  let nextFrame, now = 1000
  const loaded = [], ran = []
  const counts = { 1: 1, 2: 1 }
  const track = { stop() {}, getSettings: () => ({}) }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  const point = { x: .5, y: .5, z: 0 }
  const handModel = async (_fileset, report, _delegate, _confidence, numHands = 2) => {
    loaded.push(numHands)
    report('GPU')
    return {
      detectForVideo() {
        ran.push(numHands)
        const count = counts[numHands]
        return { landmarks: Array.from({ length: count }, () => Array(21).fill(point)), handedness: Array.from({ length: count }, () => [{ categoryName: 'Left' }]) }
      },
      close() {},
    }
  }
  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
    if (name.endsWith('/visionRuntime')) return { HAND_LANDMARKER_THRESHOLDS: THRESHOLDS,
      createHandLandmarker: handModel, createPoseLandmarker: async () => ({ detectForVideo: () => ({ landmarks: [] }), close() {} }),
      buildFrameSample: (_time, hands, pose) => ({ hands, pose }),
    }
    if (name.endsWith('/handCapacity')) return load(path.join(root, 'services/landmarks/handCapacity.ts'))
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ landmarkMode: 'hands', trackLiveTiming: true, ...options }], {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => ++now },
    requestAnimationFrame: () => 1,
  })
  harness.render().videoRef.current = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(callback) { nextFrame = callback; return 1 },
    cancelVideoFrameCallback() { nextFrame = null },
  }
  return {
    harness, loaded, ran, counts,
    async start() {
      harness.render().toggleCamera()
      harness.render()
      await new Promise(resolve => setImmediate(resolve))
    },
    frames(n) { for (let i = 0; i < n; i++) nextFrame(now, { presentedFrames: i, mediaTime: now }) },
  }
}

test('camera runs the one-hand model while one hand is tracked and reports the active hand limit', async () => {
  const camera = cameraHarness({ adaptiveHandCapacity: true })
  await camera.start()
  assert.deepEqual(camera.loaded, [2, 1])
  camera.frames(7)
  assert.deepEqual(camera.ran, [2, 2, 2, 1, 1, 2, 1])
  assert.equal(camera.harness.render().getLiveTiming().latest.handCapacity, 1)

  camera.counts[2] = 2 // second hand appears
  camera.ran.length = 0
  camera.frames(3)
  assert.deepEqual(camera.ran, [1, 2, 2])
  assert.equal(camera.harness.render().getLiveTiming().latest.handCapacity, 2)

  camera.counts[2] = 1
  camera.frames(3) // back to one-hand mode
  camera.counts[1] = 0 // tracked hand lost
  camera.ran.length = 0
  camera.frames(2)
  assert.deepEqual(camera.ran, [1, 2])
  camera.harness.unmount()
})

test('camera loads and runs only the two-hand model when the option is off', async () => {
  const camera = cameraHarness({})
  await camera.start()
  assert.deepEqual(camera.loaded, [2])
  camera.frames(6)
  assert.deepEqual(camera.ran, [2, 2, 2, 2, 2, 2])
  assert.equal(camera.harness.render().getLiveTiming().latest.handCapacity, 2)
  camera.harness.unmount()
})
