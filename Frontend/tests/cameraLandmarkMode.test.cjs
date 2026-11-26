const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')
const THRESHOLDS = { minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }

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
    if (name.endsWith('/visionRuntime')) return { HAND_LANDMARKER_THRESHOLDS: THRESHOLDS,
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
    if (name.endsWith('/visionRuntime')) return { HAND_LANDMARKER_THRESHOLDS: THRESHOLDS,
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

test('decoupled camera inference uses the latest bitmap and releases every frame', async () => {
  let now = 1000, frameId = 0, taskId = 0
  const callbacks = new Map(), tasks = new Map(), captures = [], detections = [], delivered = []
  const stream = { getTracks: () => [], getVideoTracks: () => [] }
  const root = path.join(__dirname, '../src')
  const model = name => async () => ({
    detectForVideo(source, timestamp) {
      detections.push([name, source, timestamp])
      return { landmarks: [] }
    },
    close() {},
  })
  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
    if (name.endsWith('/visionRuntime')) return { HAND_LANDMARKER_THRESHOLDS: THRESHOLDS,
      createHandLandmarker: model('hand'),
      createPoseLandmarker: model('pose'),
      buildFrameSample: timestamp => ({ timestamp }),
    }
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ decoupleVideoFrames: true, trackLiveTiming: true, onFrame: sample => delivered.push(sample.timestamp) }], {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => now },
    createImageBitmap: () => new Promise((resolve, reject) => {
      assert.equal(callbacks.size, 1, 'register the next video callback before taking a snapshot')
      captures.push({ resolve, reject })
    }),
    setTimeout(fn) { tasks.set(++taskId, fn); return taskId },
    clearTimeout(id) { tasks.delete(id) },
  })
  const feed = harness.render()
  const video = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(fn) { callbacks.set(++frameId, fn); return frameId },
    cancelVideoFrameCallback(id) { callbacks.delete(id) },
  }
  feed.videoRef.current = video
  const present = mediaTime => {
    assert.equal(callbacks.size, 1)
    const [[id, fn]] = callbacks
    callbacks.delete(id)
    fn(now, { mediaTime, presentedFrames: id })
  }
  const bitmap = () => ({ width: 1280, height: 720, closed: 0, close() { this.closed++ } })
  const drain = () => new Promise(resolve => setImmediate(resolve))
  const process = () => {
    assert.equal(tasks.size, 1)
    const [[id, fn]] = tasks
    tasks.delete(id)
    fn()
  }

  feed.toggleCamera(); harness.render(); await drain()
  present(.033)
  present(.066)
  assert.equal(captures.length, 1, 'bitmap creation is bounded while a copy is pending')
  const first = bitmap()
  captures.shift().resolve(first); await drain()
  assert.deepEqual(detections, [])
  now = 1033
  present(.066)
  const second = bitmap()
  now = 1035
  captures.shift().resolve(second); await drain()
  assert.equal(first.closed, 1, 'overwrite closes the previous frame before inference')
  process()
  assert.equal(second.closed, 1)
  assert.deepEqual(detections, [['hand', second, 1033], ['pose', second, 1033]])
  assert.deepEqual(delivered, [1033])
  assert.equal(feed.getLiveTiming().latest.frameCopyMs, 2)

  present(.066)
  assert.equal(captures.length, 0, 'duplicate source timestamp is ignored')
  now = 1033
  present(.099)
  const nonIncreasing = bitmap()
  captures.shift().resolve(nonIncreasing); await drain(); process()
  assert.equal(nonIncreasing.closed, 1)
  assert.deepEqual(delivered, [1033], 'duplicate model timestamp is ignored')

  now = 1100
  present(.132)
  const queued = bitmap()
  captures.shift().resolve(queued); await drain()
  present(.165)
  feed.toggleCamera(); harness.render()
  assert.equal(queued.closed, 1)
  assert.equal(tasks.size, 0)
  assert.equal(callbacks.size, 0)
  const late = bitmap()
  captures.shift().resolve(late); await drain()
  assert.equal(late.closed, 1)
  assert.equal(tasks.size, 0)

  feed.toggleCamera(); harness.render(); await drain()
  present(.033)
  const restarted = bitmap()
  captures.shift().resolve(restarted); await drain(); process()
  assert.deepEqual(delivered, [1033, 1100])
  present(.066)
  captures.shift().reject(Error('bitmap unavailable')); await drain()
  now = 1200
  present(.099)
  assert.deepEqual(detections.slice(-2), [['hand', video, 1200], ['pose', video, 1200]])
  harness.unmount()
  assert.equal(callbacks.size, 0)
})

test('paired camera runs hands continuously and holds each overlay hand without changing raw samples', async () => {
  let nextFrame, now = 1000, shoulderX = 0.25, tracked = true, detectedHands = 2
  let loaded = 0, closed = 0, pointsDrawn = 0
  const frames = [], poseCalls = [], handCalls = [], assignmentChecks = []
  const root = path.join(__dirname, '../src')
  const stream = { getTracks: () => [], getVideoTracks: () => [] }
  const posePoint = (x, y) => ({ x, y, z: 0, visibility: 1 })
  const hand = Array.from({ length: 21 }, () => posePoint(0.4, 0.2))
  function visionHelper(name) {
    let args
    const environment = hookHarness(path.join(root, 'services/landmarks/visionRuntime.ts'), name, name =>
      name === '@mediapipe/tasks-vision' ? {} : load(path.resolve(root, 'services/landmarks', name + '.ts')),
    () => args)
    return (...values) => { args = values; return environment.render() }
  }

  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
    if (name.endsWith('/visionRuntime')) return { HAND_LANDMARKER_THRESHOLDS: THRESHOLDS,
      createHandLandmarker: async (_fileset, report) => {
        loaded++
        report('GPU')
        return { detectForVideo(_, timestamp) {
          handCalls.push(timestamp)
          return { landmarks: Array(detectedHands).fill(hand) }
        }, close() { closed++ } }
      },
      createPoseLandmarker: async () => ({ detectForVideo(_, timestamp) {
        poseCalls.push(timestamp)
        const pose = Array.from({ length: 33 }, () => posePoint(0.5, 0.5))
        pose[11] = posePoint(shoulderX, 0.25)
        pose[12] = posePoint(0.75, 0.25)
        pose[15] = posePoint(0.25, 0.8)
        pose[16] = posePoint(0.75, 0.8)
        pose[23] = posePoint(0.25, 0.65)
        pose[24] = posePoint(0.75, 0.7)
        return { landmarks: tracked ? [pose] : [] }
      }, close() {} }),
      smoothPoseShoulders: visionHelper('smoothPoseShoulders'),
      buildFrameSample: (timestamp, _hand, pose) => ({ timestamp, pose: pose?.landmarks[0] ?? null }),
    }
    if (name.endsWith('/videoHandAssignment')) return { createStreamingHandAssignment: () =>
      (sample, result, _aspect, poseAge) => {
        assignmentChecks.push(poseAge)
        return { ...sample, leftHand: result.landmarks[0] ?? null, rightHand: result.landmarks[1] ?? null }
      } }
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ stridePairedPose: true, reviewHandTracking: true, showPoseLandmarks: false,
    trackLiveTiming: true, onFrame: sample => frames.push(sample) }], {
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    console: { warn() {} },
  })
  const feed = harness.render()
  const context = { clearRect() { pointsDrawn = 0 }, arc() { pointsDrawn++ }, beginPath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {} }
  feed.canvasRef.current = { getContext: () => context }
  feed.videoRef.current = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(fn) { nextFrame = fn; return 1 }, cancelVideoFrameCallback() {},
  }
  const drain = () => new Promise(resolve => setImmediate(resolve))
  const frame = (time) => {
    now = time
    nextFrame(time, { mediaTime: time / 1000, presentedFrames: frames.length + 1 })
    return frames.at(-1)
  }

  feed.toggleCamera(); harness.render(); await drain()
  assert.equal(frame(1000).pose[11].x, 0.25)
  assert.equal(pointsDrawn, 42)
  detectedHands = 1
  const single = frame(1050)
  assert.equal(single.pose, frames[0].pose)
  assert.equal(single.rightHand, null)
  assert.equal(pointsDrawn, 42, 'only the canvas holds the missing hand')
  detectedHands = 0
  assert.equal(frame(1100).leftHand, null)
  assert.equal(feed.getLatestFrame().rightHand, null)
  assert.equal(feed.getLiveTiming().latest.handCount, 0)
  assert.equal(pointsDrawn, 42)
  frame(1150)
  assert.equal(pointsDrawn, 42, 'both hands are within their display hold')

  shoulderX = 0.45
  const refreshed = frame(1200)
  assert.equal(refreshed.pose[11].x, 0.35)
  assert.equal(pointsDrawn, 21, 'the earlier dropout expires first')
  assert.deepEqual(handCalls, [1000, 1050, 1100, 1150, 1200], 'hands run even when the pose wrists are lowered')
  assert.deepEqual(poseCalls, [1000, 1200])
  assert.equal(frame(1250).pose, refreshed.pose)
  assert.equal(pointsDrawn, 0, 'the hold never refreshes itself')
  assert.equal(feed.getLiveTiming().latest.poseMs, 0)
  // The cached pose is passed with its age, so pose wrists count on every frame with less weight.
  assert.deepEqual(assignmentChecks, [0, 50, 100, 150, 0, 50])
  const expired = frame(1600)
  assert.equal(expired.pose, null)
  assert.equal(handCalls.at(-1), expired.timestamp)
  frame(1650)
  tracked = false
  assert.equal(frame(1700).pose, null)
  detectedHands = 1
  assert.equal(frame(1750).pose, null)
  assert.equal(pointsDrawn, 21)

  feed.toggleCamera(); harness.render()
  feed.toggleCamera(); harness.render(); await drain()
  tracked = true; detectedHands = 0
  feed.startLandmarkBenchmark()
  const restarted = frame(1800)
  assert.equal(restarted.pose[11].x, shoulderX)
  assert.equal(handCalls.at(-1), restarted.timestamp)
  assert.equal(pointsDrawn, 0, 'a camera restart clears the overlay hold')
  const report = JSON.parse(feed.stopLandmarkBenchmark())
  assert.equal(report.poseStride, 4)
  assert.equal(report.dynamicHandCapacity, false)
  assert.equal(feed.getLiveTiming().latest.handCapacity, 2)
  assert.equal(loaded, 1)
  assert.equal(closed, 0)
  harness.unmount()
  assert.equal(closed, 1)
})

test('deferred pose delivers hands first, runs pose before the next frame, and keeps samples complete', async () => {
  let nextFrame, now = 1000
  const frames = [], calls = [], assignmentChecks = [], timers = []
  const runTimers = () => { for (let id = 0; id < timers.length; id++) { const fn = timers[id]; timers[id] = null; fn?.() } }
  const root = path.join(__dirname, '../src')
  const point = (x, y) => ({ x, y, z: 0, visibility: 1 })
  const hand = Array.from({ length: 21 }, () => point(0.4, 0.2))
  const harness = hookHarness(path.join(root, 'hooks/useCameraFeed.ts'), 'useCameraFeed', name => {
    if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
    if (name.endsWith('/visionRuntime')) return { HAND_LANDMARKER_THRESHOLDS: THRESHOLDS,
      createHandLandmarker: async (_fileset, report, delegate, confidence) => {
        calls.push(['created', delegate, confidence])
        report('GPU')
        return { detectForVideo(_, timestamp) { calls.push(['hand', timestamp]); return { landmarks: [hand] } }, close() {} }
      },
      createPoseLandmarker: async () => ({ detectForVideo(_, timestamp) {
        calls.push(['pose', timestamp])
        return { landmarks: [Array.from({ length: 33 }, () => point(0.5, 0.5))] }
      }, close() {} }),
      smoothPoseShoulders: (_previous, fresh) => fresh,
      buildFrameSample: (timestamp, _hand, pose) => ({ timestamp, pose: pose?.landmarks[0] ?? null }),
    }
    if (name.endsWith('/videoHandAssignment')) return { createStreamingHandAssignment: () =>
      (sample, result, _aspect, poseAge) => {
        assignmentChecks.push(poseAge)
        return { ...sample, leftHand: result.landmarks[0] ?? null, rightHand: null }
      } }
    return load(path.resolve(root, 'hooks', name + '.ts'))
  }, () => [{ stridePairedPose: true, reviewHandTracking: true, deferPose: true, handDetectionConfidence: 0.35,
    trackLiveTiming: true, onFrame: sample => { calls.push(['frame', sample.timestamp]); frames.push(sample) } }], {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getVideoTracks: () => [] }) } },
    document: { hidden: false, createElement: () => ({ getContext: () => null }) },
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    setTimeout: fn => timers.push(fn), clearTimeout: id => { timers[id - 1] = null },
    console: { warn() {} },
  })
  const feed = harness.render()
  feed.canvasRef.current = { getContext: () => null }
  feed.videoRef.current = {
    videoWidth: 1280, videoHeight: 720, readyState: 2, play: async () => {},
    requestVideoFrameCallback(fn) { nextFrame = fn; return 1 }, cancelVideoFrameCallback() {},
  }
  const drain = () => new Promise(resolve => setImmediate(resolve))
  const frame = time => { now = time; nextFrame(time, { mediaTime: time / 1000, presentedFrames: frames.length + 1 }); return frames.at(-1) }

  feed.toggleCamera(); harness.render(); await drain()
  assert.deepEqual(calls.shift(), ['created', 'GPU', 0.35])
  assert.equal(frame(1000).pose, null, 'the first frame does not wait for pose')
  assert.deepEqual(calls, [['hand', 1000], ['frame', 1000]])
  const second = frame(1050)
  assert.deepEqual(calls.slice(2), [['pose', 1000], ['hand', 1050], ['frame', 1050]], 'pose runs before the next frame reuses its input')
  assert.ok(second.pose)
  frame(1100); frame(1150)
  runTimers()
  frame(1200)
  runTimers()
  assert.deepEqual(calls.filter(([kind]) => kind === 'pose').map(([, time]) => time), [1000, 1200], 'a scheduled pose also runs on its own')
  // No pose before the first deferred run; afterwards the cached pose's age.
  assert.deepEqual(assignmentChecks, [false, 50, 100, 150, 200])
  const report = JSON.parse((feed.startLandmarkBenchmark(), frame(1250), feed.stopLandmarkBenchmark()))
  assert.equal(report.poseScheduling, 'after hand landmarks')
  assert.equal(report.handThresholds.minHandDetectionConfidence, 0.35)
  harness.unmount()
})
