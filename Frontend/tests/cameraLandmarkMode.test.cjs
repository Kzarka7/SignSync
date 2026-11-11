const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')

test('camera modes load and run only the selected detectors, even after both are cached', async () => {
  let landmarkMode, nextFrame, now = 1000
  const loaded = [], detected = []
  const track = { stop() {}, getSettings: () => ({}) }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  const model = name => async (_fileset, report) => {
    loaded.push(name)
    report('GPU')
    return {
      detectForVideo() { detected.push(name); return { landmarks: [[]], handedness: [[{ categoryName: 'Left' }]] } },
      close() {},
    }
  }
  const root = path.join(__dirname, '../src')
  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
    if (name.endsWith('/visionRuntime')) return {
      createHandLandmarker: model('hands'), createPoseLandmarker: model('pose'),
      buildFrameSample: (_time, hands, pose) => ({ hands, pose }),
    }
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ landmarkMode, trackLiveTiming: true }], {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => ++now },
  })
  harness.render().videoRef.current = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(callback) { nextFrame = callback; return 1 },
    cancelVideoFrameCallback() { nextFrame = null },
  }

  async function run(mode, expected) {
    landmarkMode = mode
    detected.length = 0
    harness.render().toggleCamera()
    harness.render()
    await new Promise(resolve => setImmediate(resolve))
    nextFrame(now, { presentedFrames: 1 })
    const feed = harness.render()
    assert.deepEqual(detected, expected)
    assert.equal(feed.handsDetected, expected.includes('hands'))
    assert.equal(feed.poseDetected, expected.includes('pose'))
    assert.equal(feed.getLiveTiming().handDelegate, feed.handsDetected ? 'GPU' : null)
    assert.equal(feed.getLiveTiming().latest.singleHandSide, feed.handsDetected ? 'Right' : undefined)
    assert.equal(feed.getLiveTiming().poseDelegate, feed.poseDetected ? 'GPU' : null)
    feed.toggleCamera()
    harness.render()
    assert.equal(feed.getLiveTiming(), null)
  }

  await run('pose', ['pose'])
  assert.deepEqual(loaded, ['pose'])
  await run('hands', ['hands'])
  assert.deepEqual(loaded, ['pose', 'hands'])
  await run(undefined, ['hands', 'pose'])
  await run('pose', ['pose'])
  await run('hands', ['hands'])
  assert.deepEqual(loaded, ['pose', 'hands'])
  harness.unmount()
})

test('worker delivers one paired observation per submitted frame and ignores results after stop', async () => {
  let nextFrame, now = 1000
  const sent = [], observations = []
  let terminated = false
  const worker = {
    postMessage(data, transfer) { sent.push({ data, transfer }) },
    terminate() { terminated = true },
  }
  const bitmap = { close() {} }
  const track = { stop() {}, getSettings: () => ({}) }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  const root = path.join(__dirname, '../src')
  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return {}
    if (name.endsWith('/pairedLandmarksWorker')) return { createPairedLandmarksWorker: () => worker }
    if (name.endsWith('/visionRuntime')) return {
      buildFrameSample: (timestamp, hands, pose) => ({ timestamp, hands, pose }),
    }
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ usePairedLandmarksWorker: true, trackLiveTiming: true, onFrame: frame => observations.push(frame) }], {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => ++now },
    createImageBitmap: async () => bitmap,
  })
  harness.render().videoRef.current = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(callback) { nextFrame = callback; return 1 },
    cancelVideoFrameCallback() { nextFrame = null },
  }
  harness.render().toggleCamera()
  harness.render()
  await new Promise(resolve => setImmediate(resolve))
  worker.onmessage({ data: { type: 'ready', hands: { delegate: 'GPU' }, pose: { delegate: 'GPU' } } })
  const capture = nextFrame
  nextFrame = null
  capture(now, { mediaTime: .1, presentedFrames: 1 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.bitmap, bitmap)
  assert.equal(sent[0].transfer[0], bitmap)
  assert.equal(nextFrame, null)
  assert.equal(observations.length, 0)

  const hands = { landmarks: [[]] }, pose = { landmarks: [[]] }
  const result = { data: { type: 'result', hands, pose, handMs: 30, poseMs: 15 } }
  worker.onmessage(result)
  assert.equal(observations.length, 1)
  assert.equal(observations[0].timestamp, sent[0].data.timestamp)
  assert.equal(observations[0].hands, hands)
  assert.equal(observations[0].pose, pose)
  assert.equal(typeof nextFrame, 'function')

  harness.render().toggleCamera()
  harness.render()
  assert.equal(terminated, true)
  worker.onmessage(result)
  assert.equal(observations.length, 1)
  harness.unmount()
})
