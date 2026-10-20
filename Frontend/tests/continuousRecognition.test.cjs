const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { createRecognitionWindows, createActivityPolicy, createObservationTracking, CONTINUOUS_SETTINGS } = load(path.resolve('src/services/landmarks/continuousRecognition.ts'))
const { createDiagnosticSession } = load(path.resolve('src/services/landmarks/recognitionDiagnostics.ts'))

function feature(t, valid = true, hands = true) {
  const features = Array(164).fill(0); features[36] = hands ? 1 : 0; features[7] = features[11] = 1
  return { timestamp: t, valid, features }
}
function raw(t, hands = true, valid = true) {
  const point = (x, y) => ({ x, y, z: 0, visibility: 1 })
  const hand = Array.from({ length: 21 }, (_, i) => point(.4 + i * .001, .6))
  return { timestamp: t, leftHand: hands ? hand : null, rightHand: null,
    pose: valid ? { nose: point(.5, .1), leftShoulder: point(.3, .3), rightShoulder: point(.7, .3),
      leftElbow: point(.3, .5), rightElbow: point(.7, .5), leftWrist: point(.4, .6), rightWrist: point(.7, .7),
      leftHip: point(.4, .9), rightHip: point(.6, .9) } : null }
}
const prediction = (label, accepted = !['REST', 'IDLE_MOVEMENT'].includes(label)) => ({
  requestId: 'test', label, accepted, score: .99, top3: [{ label, score: .99 }, { label: 'OTHER', score: .01 }], model: 'test', inferenceMs: 5, frameCount: 31,
})

test('windows keep advancing during rest and motion, and require fresh coverage after a gap', () => {
  const buffer = createRecognitionWindows(), windows = []
  for (let t = 0; t <= 6000; t += 50) {
    const window = buffer.push(feature(t, true, t > 3000))
    if (window) windows.push(window)
  }
  assert.equal(windows[0].endMs, 1500)
  assert.equal(windows[0].handFraction, 0)
  assert.ok(windows.at(-1).endMs >= 5700)
  assert.ok(windows.at(-1).handFraction > .99)
  assert.equal(buffer.push(feature(7000)), null)
  for (let t = 7050; t < 8500; t += 50) assert.equal(buffer.push(feature(t)), null)
  assert.equal(buffer.push(feature(8500)).endMs, 8500)
  assert.throws(() => buffer.push(feature(8500)), /increase/)
})

test('poor tracking produces an explicit quality failure and high FPS stays within API limits', () => {
  const bad = createRecognitionWindows()
  let window
  for (let t = 0; t <= 1500; t += 50) window = bad.push(feature(t, false))
  assert.equal(window.quality, 'pose_tracking_unusable')
  const fast = createRecognitionWindows()
  for (let t = 0; t <= 1500; t += 2) window = fast.push(feature(t))
  assert.equal(window.frames.length, 240)
  assert.equal(window.frames[0].timestamp, 0)
  assert.equal(window.frames.at(-1).timestamp, 1500)
})

test('idle to sign works with visible hands; held signs emit once and non-sign evidence rearms', () => {
  const policy = createActivityPolicy(), entries = []
  const labels = ['REST', 'IDLE_MOVEMENT', 'IDLE_MOVEMENT', 'THANK_YOU', 'THANK_YOU', 'THANK_YOU',
    'REST', 'IDLE_MOVEMENT', 'REST', 'REST', 'YES', 'YES', 'YES']
  labels.forEach((label, i) => {
    const decision = policy.update(prediction(label), 1500 + i * 350)
    if (decision.emit) entries.push(label)
  })
  assert.deepEqual(entries, ['THANK_YOU', 'YES'])
  assert.equal(policy.update(prediction('YES'), 6050).emit, false)
})

test('uncertain, blocked, or widely separated results cannot confirm a sign or rearm a latch', () => {
  const policy = createActivityPolicy()
  assert.equal(policy.update(prediction('WHO'), 1500).emit, false)
  assert.equal(policy.update(prediction('WHO'), 1850, 'stale_result').activity, 'UNCERTAIN')
  assert.equal(policy.update(prediction('WHO'), 2200).emit, false)
  assert.equal(policy.update(prediction('WHO'), 5000).emit, false)
  assert.equal(policy.update(prediction('WHO'), 5350).emit, true)
  policy.update(prediction('REST'), 5700)
  policy.update(null, 6050, 'pose_tracking_unusable')
  policy.update(prediction('REST'), 6400)
  assert.equal(policy.update(prediction('YES'), 6750).emit, false)
  assert.equal(policy.update(prediction('YES'), 7100).emit, true)
  // A confident wrong sign can still pass: the test documents the policy limit.
})

test('low-confidence non-sign output stays visible but cannot rearm acceptance', () => {
  const policy = createActivityPolicy()
  policy.update(prediction('HELLO'), 1500)
  policy.update(prediction('HELLO'), 1850)
  for (let t = 2200; t < 5000; t += 350) {
    const result = policy.update({ ...prediction('REST'), score: .4 }, t)
    assert.equal(result.reason, 'uncertain_non_sign')
  }
  assert.equal(policy.update(prediction('YES'), 5000).emit, false)
  assert.equal(policy.update(prediction('YES'), 5350).emit, true)
})

test('two of three tolerates one rejected result or different label, but latest must support the winner', () => {
  for (const middle of [prediction('YES'), prediction('HELLO', false), prediction('REST')]) {
    const policy = createActivityPolicy()
    assert.equal(policy.update(prediction('HELLO'), 0).emit, false)
    assert.equal(policy.update(middle, 350).emit, false)
    assert.equal(policy.update(prediction('HELLO'), 700).emit, true)
  }
  const policy = createActivityPolicy()
  policy.update(prediction('HELLO'), 0)
  policy.update(prediction('YES'), 350)
  assert.equal(policy.update(prediction('NO'), 700).emit, false)
  assert.equal(policy.update(prediction('HELLO'), 1050).emit, false) // first vote has expired
  assert.equal(policy.update(prediction('HELLO'), 1100).emit, false) // insufficient time span
})

test('different signs print without rest; duplicates and reused evidence cannot print', () => {
  const policy = createActivityPolicy(), entries = []
  const labels = ['HELLO', 'HELLO', 'HELLO', 'YES', 'HELLO', 'YES', 'YES', 'HELLO', 'HELLO']
  labels.forEach((label, i) => {
    const result = policy.update(prediction(label), i * 350)
    if (result.emit) entries.push(label)
    if (i === 2 || i === 6) assert.equal(result.reason, 'duplicate_sign_suppressed')
    if (i === 4) assert.equal(result.emit, false)
  })
  assert.deepEqual(entries, ['HELLO', 'YES', 'HELLO'])
})

test('comparison preset requires three of four over 400 ms and exports actual session settings', async () => {
  const settings = { strideMs: 200, confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 400 }
  const policy = createActivityPolicy(settings)
  assert.equal(policy.update(prediction('YES'), 0).emit, false)
  assert.equal(policy.update(prediction('YES', false), 200).emit, false)
  assert.equal(policy.update(prediction('YES'), 400).emit, false)
  assert.equal(policy.update(prediction('YES'), 600).emit, true)
  const session = createDiagnosticSession({ source: 'video', name: 'preset', settings,
    onChange() {}, now: () => 0, id: () => 'preset', predict: async () => prediction('YES') })
  for (let t = 0; t <= 2500; t += 50) await session.observe(raw(t))
  const report = session.report()
  assert.equal(report.settings.windowMs, 1500)
  assert.equal(report.settings.strideMs, 200)
  assert.equal(report.settings.confirmationWindows, 3)
  assert.equal(report.settings.confirmationHistory, 4)
  assert.equal(report.transcript[0].decisionMs, 1900)
  assert.deepEqual(Array.from(report.rows.slice(0, 3), row => row.endMs), [1500, 1700, 1900])
})

test('150 ms trial keeps the 400 ms acceptance span and 1500 ms movement window', async () => {
  const settings = { strideMs: 150, confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 400 }
  const policy = createActivityPolicy(settings)
  assert.equal(policy.update(prediction('YES'), 0).emit, false)
  assert.equal(policy.update(prediction('YES', false), 150).emit, false)
  assert.equal(policy.update(prediction('YES'), 300).emit, false)
  assert.equal(policy.update(prediction('YES'), 450).emit, true)
  const session = createDiagnosticSession({ source: 'video', name: '150 ms', settings,
    onChange() {}, now: () => 0, id: () => 'trial', predict: async () => prediction('YES') })
  for (let t = 0; t <= 2200; t += 50) await session.observe(raw(t))
  const report = session.report()
  assert.equal(report.settings.windowMs, 1500)
  assert.equal(report.settings.strideMs, 150)
  assert.equal(report.settings.confirmationMs, 400)
  assert.equal(report.transcript[0].decisionMs, 1950)
  assert.deepEqual(Array.from(report.rows.slice(0, 4), row => row.endMs), [1500, 1650, 1800, 1950])
})

test('two-of-three cannot bridge invalid tracking, stale predictions, or long evidence gaps', () => {
  for (const reason of ['pose_tracking_unusable', 'stale_result', 'tracking_changed_during_inference']) {
    const policy = createActivityPolicy()
    policy.update(prediction('HELLO'), 0)
    policy.update(prediction('HELLO'), 350, reason)
    assert.equal(policy.update(prediction('HELLO'), 700).emit, false)
  }
  const policy = createActivityPolicy()
  policy.update(prediction('HELLO'), 0)
  assert.equal(policy.update(prediction('HELLO'), 1100).emit, false)
})

test('low-FPS sessions still expose frames and tracking gaps for export', async () => {
  let updates = 0
  const session = createDiagnosticSession({ source: 'camera', name: 'slow camera', onChange() { updates++ },
    predict: async () => { throw Error('No complete window should be sent') } })
  for (let t = 0; t <= 4000; t += 500) await session.observe(raw(t))
  assert.equal(session.state.frames, 9)
  assert.equal(session.state.rows.length, 0)
  assert.equal(session.state.frameGaps, 8)
  assert.ok(updates >= 8)
  session.stop()
})

test('offline replay logs raw output, keeps source time, and does not drop windows during inference', async () => {
  let clock = 0, requests = []
  const session = createDiagnosticSession({ source: 'video', name: 'test', now: () => clock,
    id: () => `r${requests.length}`, onChange() {}, predict: async request => {
      requests.push(request); clock += 4000
      return { ...prediction(request.frames.at(-1).timestamp < 2500 ? 'REST' : 'HELLO'), requestId: request.requestId }
    } })
  for (let t = 9000; t <= 13500; t += 50) await session.observe(raw(t))
  await session.finish()
  const report = session.report()
  assert.equal(report.frames[0].timestamp, 0)
  assert.equal(report.summary.replacedWindows, 0)
  assert.equal(report.summary.staleResults, 0)
  assert.equal(report.rows.length, requests.length)
  assert.equal(report.rows[0].prediction.label, 'REST')
  assert.equal(report.transcript.length, 1)
  assert.ok(report.rows.every(row => row.roundTripMs === 4000))
  assert.equal(report.settings.windowMs, CONTINUOUS_SETTINGS.windowMs)
  assert.equal(report.purpose, 'development-only')
})

test('live inference keeps only the latest pending window and blocks stale results', async () => {
  let clock = 0, resolve, requests = []
  const session = createDiagnosticSession({ source: 'camera', name: 'test', now: () => clock, id: () => `r${requests.length}`,
    onChange() {}, predict: request => { requests.push(request); return new Promise(done => { resolve = done }) } })
  for (let t = 0; t <= 5000; t += 50) { clock = t; await session.observe(raw(t)) }
  assert.equal(requests.length, 1)
  assert.ok(session.state.replacedWindows >= 5)
  resolve(prediction('WHO')); await new Promise(done => setImmediate(done))
  assert.equal(session.state.rows[0].reason, 'stale_result')
  assert.equal(session.state.transcript.length, 0)
  assert.equal(requests.length, 2)
  assert.ok(requests[1].frames.at(-1).timestamp >= 4800)
  session.stop()
  resolve(prediction('YES')); await new Promise(done => setImmediate(done))
  assert.equal(session.state.rows.length, 1)
  assert.equal(session.state.transcript.length, 0)
})

test('unusable pose is logged without sending to the backend; inference failures stop the session', async () => {
  let calls = 0
  const session = createDiagnosticSession({ source: 'video', name: 'test', now: () => 0, id: () => 'test', onChange() {},
    predict: async () => { calls++; throw Error('Disconnected') } })
  for (let t = 0; t <= 1500; t += 50) await session.observe(raw(t, true, false))
  assert.equal(calls, 0)
  assert.equal(session.state.rows[0].reason, 'pose_tracking_lost')
  for (let t = 1550; t <= 4000; t += 50) await session.observe(raw(t))
  assert.equal(calls, 1)
  assert.equal(session.active, false)
  assert.match(session.state.failure, /Disconnected/)
})

test('intentional stop cannot become an inference failure when transport cancellation rejects', async () => {
  let reject
  const session = createDiagnosticSession({ source: 'camera', name: 'stop test', now: () => 0, id: () => 'stop',
    onChange() {}, predict: () => new Promise((resolve, fail) => { reject = fail }) })
  for (let t = 0; t <= 1500; t += 50) await session.observe(raw(t))
  session.stop()
  reject(Error('Diagnostics stopped'))
  await new Promise(done => setImmediate(done))
  assert.equal(session.state.failure, null)
  assert.equal(session.state.status, 'Stopped')
  assert.equal(session.state.rows.length, 0)
})

test('no-hands IDLE requires sustained absence and valid shoulders, independent of body position', () => {
  for (const shoulderY of [.25, .65]) {
    const tracker = createObservationTracking()
    let state
    for (let t = 0; t <= 500; t += 50) {
      const f = feature(t, true, false); f.features[5] = f.features[9] = shoulderY
      state = tracker.push(f)
      assert.equal(state.state, t < 500 ? 'hands-missing' : 'no-hands')
    }
    const lost = feature(550, true, false); lost.features[7] = .2
    assert.equal(tracker.push(lost).state, 'pose-lost')
    assert.equal(tracker.push(feature(600, true, false)).state, 'hands-missing')
    assert.equal(tracker.push(feature(650, false, false)).state, 'pose-lost')
  }
})

test('brief hand loss, pose loss and missing observation time do not release a held sign', () => {
  const tracker = createObservationTracking(), policy = createActivityPolicy()
  const observe = (t, hands = true, valid = true) => policy.observeTracking(tracker.push(feature(t, valid, hands)))
  observe(0); policy.update(prediction('HELLO'), 0)
  observe(200); observe(350); policy.update(prediction('HELLO'), 350)
  assert.equal(policy.state.waitingForBoundary, true)
  observe(400, false); observe(600, false); observe(650)
  assert.equal(policy.state.waitingForBoundary, true)
  observe(700, false); observe(900, false)
  observe(111900, false)
  assert.equal(policy.state.waitingForBoundary, true)
  assert.equal(policy.state.boundaryEvidenceMs, 0)
  for (let t = 111950; t <= 112650; t += 50) observe(t, false)
  assert.equal(policy.state.waitingForBoundary, true)
  observe(112700, false, false)
  assert.equal(policy.state.boundaryEvidenceMs, 0)
  assert.equal(policy.state.waitingForBoundary, true)
})

test('sustained tracked hand absence rearms after IDLE grace; brief dropouts do not duplicate signs', async () => {
  const session = createDiagnosticSession({ source: 'video', name: 'visibility rule', onChange() {}, now: () => 0,
    id: (() => { let i = 0; return () => `rule-${++i}` })(), predict: async request => {
      const visible = request.frames.filter(f => f.features[36] || f.features[100]).length / request.frames.length
      return { ...prediction('HELLO', visible >= .5), requestId: request.requestId,
        ...(visible < .5 ? { rejectionReason: 'insufficient_hand_visibility' } : {}) }
    } })
  for (let t = 0; t <= 6500; t += 50) {
    const hands = !(t >= 2500 && t < 4500) && !(t >= 2000 && t < 2200)
    await session.observe(raw(t, hands))
  }
  const report = session.report()
  assert.equal(report.transcript.length, 2)
  assert.equal(report.summary.rearmedByNoHands, 1)
  assert.equal(report.summary.rearmedByModel, 0)
  const idle = report.rows.filter(row => row.reason === 'no_hands_idle_rule')
  assert.ok(idle.length >= 2)
  assert.ok(idle.every(row => row.emit === false && row.activity === 'IDLE'))
  assert.ok(idle.some(row => row.prediction.label === 'HELLO'))
  assert.ok(report.acceptanceEvents.some(event => event.type === 'rearmed' && event.source === 'no-hands' && event.evidenceMs >= 750))
})

test('a prediction cannot complete confirmation after hand loss and recovery during inference', async () => {
  let resolve, calls = 0
  const session = createDiagnosticSession({ source: 'camera', name: 'tracking race', onChange() {}, now: () => 0, id: () => `race-${calls}`,
    predict: request => {
      calls++
      if (calls === 1) return Promise.resolve({ ...prediction('HELLO'), requestId: request.requestId })
      return new Promise(done => { resolve = done })
    } })
  for (let t = 0; t <= 1850; t += 50) await session.observe(raw(t))
  assert.equal(session.state.rows[0].reason, 'confirming')
  await session.observe(raw(1900, false))
  await session.observe(raw(1950, true))
  resolve(prediction('HELLO')); await new Promise(done => setImmediate(done))
  assert.equal(session.state.rows[1].reason, 'tracking_changed_during_inference')
  assert.equal(session.state.transcript.length, 0)
  session.stop()
})

test('pose loss shows tracking lost rather than IDLE even when a model sign would be accepted', async () => {
  const session = createDiagnosticSession({ source: 'video', name: 'pose lost', onChange() {}, now: () => 0,
    predict: async () => prediction('WHO') })
  for (let t = 0; t <= 2500; t += 50) await session.observe(raw(t, false, false))
  assert.equal(session.state.tracking.state, 'pose-lost')
  assert.ok(session.state.rows.every(row => row.activity === 'TRACKING LOST' && !row.emit))
  assert.equal(session.state.transcript.length, 0)
})
