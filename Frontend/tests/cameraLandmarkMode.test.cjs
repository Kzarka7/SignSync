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
    requestAnimationFrame: () => 1,
  })
  harness.render().videoRef.current = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(callback) { nextFrame = callback; return 1 },
    cancelVideoFrameCallback() { nextFrame = null },
  }

  async function run(mode, expected, keepCameraOn = false) {
    landmarkMode = mode
    detected.length = 0
    const current = harness.render()
    if (!current.enabled) current.toggleCamera()
    harness.render()
    await new Promise(resolve => setImmediate(resolve))
    harness.render().startLandmarkBenchmark()
    nextFrame(now, { presentedFrames: 1, mediaTime: 1 })
    const feed = harness.render()
    assert.deepEqual(detected, expected)
    assert.equal(feed.handsDetected, expected.includes('hands'))
    assert.equal(feed.poseDetected, expected.includes('pose'))
    assert.equal(feed.getLiveTiming().handDelegate, feed.handsDetected ? 'GPU' : null)
    assert.equal(feed.getLiveTiming().latest.singleHandSide, feed.handsDetected ? 'Right' : undefined)
    assert.equal(feed.getLiveTiming().poseDelegate, feed.poseDetected ? 'GPU' : null)
    const report = JSON.parse(feed.stopLandmarkBenchmark())
    assert.equal(report.landmarkMode, mode ?? 'both')
    assert.equal(report.handDelegate, expected.includes('hands') ? 'GPU' : 'disabled')
    assert.equal(report.poseDelegate, expected.includes('pose') ? 'GPU' : 'disabled')
    assert.deepEqual(report.overlay, { hands: expected.includes('hands'), pose: expected.includes('pose') })
    if (!keepCameraOn) {
      feed.toggleCamera()
      harness.render()
      assert.equal(feed.getLiveTiming(), null)
    }
  }

  await run('pose', ['pose'])
  assert.deepEqual(loaded, ['pose'])
  await run('hands', ['hands'])
  assert.deepEqual(loaded, ['pose', 'hands'])
  await run(undefined, ['hands', 'pose'], true)
  await run('pose', ['pose'], true)
  await run('hands', ['hands'])
  assert.deepEqual(loaded, ['pose', 'hands'])
  harness.unmount()
})

test('review-style camera overlay swaps colors while recognition receives the stable hand slot', async () => {
  let nextFrame, now = 1000, side = 'Right'
  const points = Array.from({ length: 21 }, () => ({ x: .4, y: .5, z: 0 }))
  const samples = [], fills = [], paintCallbacks = []
  const context = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, stroke() {},
    fill() { fills.push(this.fillStyle) } }
  const stream = { getTracks: () => [], getVideoTracks: () => [] }
  const root = path.join(__dirname, '../src')
  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
    if (name.endsWith('/visionRuntime')) return {
      createHandLandmarker: async () => ({ detectForVideo: () => ({ landmarks: [points], handedness: [[{ categoryName: side, score: .99 }]] }), close() {} }),
      buildFrameSample: timestamp => ({ timestamp, leftHand: null, rightHand: null, pose: null }),
    }
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ landmarkMode: 'hands', reviewHandTracking: true, trackLiveTiming: true, trackOverlayPaint: true,
    onFrame: frame => samples.push(frame) }], {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => ++now },
    requestAnimationFrame: callback => paintCallbacks.push(callback),
  })
  const feed = harness.render()
  feed.videoRef.current = { videoWidth: 640, videoHeight: 480, readyState: 2, play: async () => {},
    requestVideoFrameCallback(callback) { nextFrame = callback; return 1 }, cancelVideoFrameCallback() {} }
  feed.canvasRef.current = { width: 640, height: 480, getContext: () => context }
  feed.toggleCamera(); harness.render()
  await new Promise(resolve => setImmediate(resolve))
  nextFrame(now, { mediaTime: .033, presentedFrames: 1 })
  assert.equal(paintCallbacks.length, 1)
  paintCallbacks.shift()()
  assert.equal(paintCallbacks.length, 1)
  paintCallbacks.shift()()
  assert.ok(feed.getLiveTiming().latest.overlayPaintOpportunityMs > 0)

  feed.startLandmarkBenchmark()
  side = 'Left'; now += 33
  nextFrame(now, { mediaTime: .066, presentedFrames: 2 })
  assert.equal(paintCallbacks.length, 1)
  paintCallbacks.shift()()
  assert.equal(paintCallbacks.length, 1)
  paintCallbacks.shift()()
  const report = JSON.parse(feed.stopLandmarkBenchmark())
  assert.equal(report.completedCallbacks, 1)
  assert.equal(report.benchmark.callbackToOverlayPaintOpportunityMs.count, 1)
  assert.equal(samples.length, 2)
  assert.ok(samples.every(sample => sample.rightHand === points && sample.leftHand === null))
  assert.equal(fills.length, 42)
  assert.ok(fills.every(color => color === '#22c55e'))
  assert.equal(harness.render().getLiveTiming().latest.singleHandSide, 'Left')
  now += 33
  nextFrame(now, { mediaTime: .099, presentedFrames: 3 })
  assert.equal(paintCallbacks.length, 1)
  harness.unmount()
})
