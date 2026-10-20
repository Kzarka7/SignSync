const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { hookHarness } = require('./helpers/hookHarness.cjs')
const normalize = load(path.resolve('src/services/landmarks/normalize.ts'))
const captureModule = load(path.resolve('src/services/landmarks/continuousSignCapture.ts'))
function frame(t, offset = 0) {
  const point = (x, y) => ({ x, y, z: 0, visibility: 1 })
  const hand = (x, dy) => Array.from({ length: 21 }, (_, i) => point(x + i % 4 * .01, .75 + dy - i * .004))
  return { timestamp: t, leftHand: hand(.3, offset), rightHand: hand(.7, 0), pose: {
    nose: point(.5, .15), leftShoulder: point(.25, .3), rightShoulder: point(.75, .3),
    leftElbow: point(.25, .55), rightElbow: point(.75, .55),
    leftWrist: point(.3, .75 + offset), rightWrist: point(.7, .75),
    leftHip: point(.35, .9), rightHip: point(.65, .9),
  }}
}
function gesture(t, start, end) {
  if (t < start || t > end + 500) return 0
  if (t < start + 500) return -.25 * (t - start) / 500
  if (t <= end) return -.25
  return -.25 * (1 - (t - end) / 500)
}
test('sign rest sign yields two distinct complete requests; holds do not repeat', () => {
  const capture = captureModule.createContinuousSignCapture(), segments = []
  for (let t = 0; t <= 10000; t += 50) {
    segments.push(...capture.push(frame(t, gesture(t, 1800, 4200) + gesture(t, 6500, 7400))))
  }
  const signs = segments.filter(s => s.event.type === 'segment')
  assert.equal(signs.length, 2)
  assert.ok(signs[0].event.endMs < signs[1].event.startMs)
  for (const sign of signs) {
    assert.equal(sign.frames.length, sign.event.frameCount)
    assert.equal(sign.frames[0].timestamp, sign.event.startMs)
    assert.equal(sign.frames.at(-1).timestamp, sign.event.endMs)
    assert.equal(sign.frames[0].features.length, 164)
  }
})
test('continuous capture queues a second sign during inference and stops safely', () => {
  let options, ready = true, candidate = true, connected = true
  const sent = []
  const feed = { enabled: true, cameraReady: true, poseDetected: true }
  const send = request => { if (!ready) return false; sent.push(request); ready = false; return true }
  const harness = hookHarness('src/hooks/useLiveSignCapture.ts', 'useLiveSignCapture', name => {
    if (name === './useCameraFeed') return { useCameraFeed: value => { options = value; return feed } }
    if (name.endsWith('/normalize')) return normalize
    if (name.endsWith('/continuousSignCapture')) return captureModule
    throw Error(name)
  }, () => [send, ready, candidate, connected])
  harness.render().startContinuous(); harness.render()
  for (let t = 0; t <= 8000; t += 50) {
    options.onFrame(frame(t, gesture(t, 1800, 2700) + gesture(t, 4500, 5400)))
    harness.render()
  }
  assert.equal(sent.length, 1)
  assert.equal(harness.render().queued, 1)
  ready = true; harness.render()
  assert.equal(sent.length, 2)
  assert.notEqual(sent[0].requestId, sent[1].requestId)
  assert.equal(harness.render().continuous, true)
  harness.render().stopContinuous(); harness.render()
  assert.equal(harness.render().queued, 0)
  assert.equal(harness.render().continuous, false)
  for (let t = 8050; t < 12000; t += 50) options.onFrame(frame(t, gesture(t, 8500, 9400)))
  assert.equal(sent.length, 2)
  ready = true; harness.render().startContinuous(); harness.render()
  connected = false; assert.equal(harness.render().continuous, false)
  harness.unmount()
})
test('camera loss clears pending captures and v5 cannot enable continuous mode', () => {
  let options, candidate = true
  const feed = { enabled: true, cameraReady: true, poseDetected: true }
  const harness = hookHarness('src/hooks/useLiveSignCapture.ts', 'useLiveSignCapture', name => {
    if (name === './useCameraFeed') return { useCameraFeed: value => { options = value; return feed } }
    if (name.endsWith('/normalize')) return normalize
    if (name.endsWith('/continuousSignCapture')) return captureModule
    throw Error(name)
  }, () => [() => false, true, candidate, true])
  harness.render().startContinuous(); assert.equal(harness.render().continuous, true)
  feed.enabled = false; assert.equal(harness.render().continuous, false)
  feed.enabled = true; candidate = false; harness.render().startContinuous()
  assert.equal(harness.render().continuous, false)
  harness.unmount()
})


test('no hands immediately establish a no-sign rest state despite wrist jitter', () => {
  const capture = captureModule.createContinuousSignCapture()
  for (let t = 0; t <= 2000; t += 50) {
    const sample = frame(t, Math.sin(t) * .08)
    sample.leftHand = sample.rightHand = null
    assert.equal(capture.push(sample).length, 0)
    assert.equal(capture.phase, 'no-sign')
  }
})
test('hands entering then disappearing separate two captures, including a held sign', () => {
  const capture = captureModule.createContinuousSignCapture(), events = []
  for (let t = 0; t <= 7000; t += 50) {
    const sample = frame(t, -.25)
    if (!(t >= 1000 && t < 2300) && !(t >= 4200 && t < 5500)) {
      sample.leftHand = sample.rightHand = null
    }
    events.push(...capture.push(sample))
  }
  assert.equal(events.filter(e => e.event.type === 'segment').length, 2)
  assert.equal(events.filter(e => e.event.type === 'discard').length, 0)
  assert.equal(capture.phase, 'no-sign')
  for (const result of events) {
    assert.ok(result.event.handPresenceFraction >= .5)
    assert.ok(result.frames.length >= 8)
  }
})
test('brief missing hands do not split a sign, and missing pose is not a resting state', () => {
  const capture = captureModule.createContinuousSignCapture(), events = []
  for (let t = 0; t <= 4000; t += 50) {
    const sample = frame(t, -.25)
    if (t < 1000 || (t >= 1600 && t < 1800) || t >= 2500) sample.leftHand = sample.rightHand = null
    events.push(...capture.push(sample))
  }
  assert.equal(events.filter(e => e.event.type === 'segment').length, 1)
  const missing = frame(4100); missing.pose = null; missing.leftHand = missing.rightHand = null
  capture.push(missing)
  assert.equal(capture.phase, 'calibrating')
})
