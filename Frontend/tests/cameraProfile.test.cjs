const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const output = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/services/cameraProfile.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: output })
const sample = (completedAt, presentedFrames) => ({ completedAt, presentedFrames, handMs: 30, poseMs: 40, overlayMs: 5, resizeMs: 2, otherMs: 3, totalMs: 80, hidden: false })

test('separates completed work, compositor cadence, processing time and waiting', () => {
  const profile = output.createCameraProfile()
  profile.start()
  profile.add(sample(100, 1))
  profile.add(sample(200, 4))
  profile.add({ ...sample(300, 7), hidden: true })
  const report = profile.snapshot()
  assert.equal(report.processedFps, 10)
  assert.equal(report.browserPresentedFps, 30)
  assert.equal(report.averageMs.handMs, 30)
  assert.equal(report.averageMs.totalMs, 80)
  assert.equal(report.averageBetweenCallbacksMs, 20)
  assert.equal(report.hiddenFrames, 1)
  profile.stop()
  profile.add(sample(1000, 50))
  assert.equal(profile.snapshot().completedCallbacks, 3)
  profile.start()
  assert.equal(profile.snapshot().completedCallbacks, 0)
  assert.equal(profile.snapshot().processedFps, null)
  profile.add(sample(2000))
  assert.equal(profile.snapshot().browserPresentedFps, null)
  assert.equal(profile.snapshot().processedFps, null)
})

test('live timing bounds the history and expires stale camera readings', () => {
  const recent = output.createRecentCameraTiming()
  for (let i = 0; i < 60; i++) recent.add(sample(i * 40, i * 2))
  const timing = recent.snapshot(2400)
  assert.equal(timing.samples.length, 48)
  assert.equal(timing.latest.handMs, 30)
  assert.equal(timing.latest.poseMs, 40)
  assert.equal(timing.processedFps, 25)
  assert.equal(timing.presentedFps, 50)
  assert.equal(recent.snapshot(3400), null)
  recent.add(sample(3500))
  assert.equal(recent.snapshot(3500).processedFps, null)
  assert.equal(recent.snapshot(3500).presentedFps, null)
  recent.add({ ...sample(3540, 62), hidden: true })
  assert.equal(recent.snapshot(3540), null)
  recent.add(sample(3580, 63))
  recent.clear()
  assert.equal(recent.snapshot(3580), null)
})

test('landmark benchmark counts fresh video frames with hands and reports tail timings', () => {
  const profile = output.createCameraProfile()
  profile.start(true)
  const add = (completedAt, mediaTime, handsDetected, overlayPaintOpportunityMs) =>
    profile.add({ ...sample(completedAt, completedAt / 10), mediaTime, handsDetected, overlayPaintOpportunityMs })
  add(100, 0, true, 90)
  add(200, 0, true, 110) // A second result for the same video frame.
  add(300, 1, false, 120)
  add(400, 2, true, 105)
  profile.stop()

  const report = profile.snapshot()
  assert.equal(report.processedFps, 10)
  assert.equal(report.benchmark.freshHandUpdates, 2)
  assert.equal(report.benchmark.freshHandFps, 3.33)
  assert.equal(report.benchmark.freshHandUpdateGapMs.p95, 300)
  assert.equal(report.benchmark.callbackToOverlayPaintOpportunityMs.median, 107.5)
  assert.equal(report.benchmark.callbackToOverlayPaintOpportunityMs.p95, 120)
  profile.start()
  assert.equal(profile.snapshot().benchmark, undefined)
})

test('benchmark counts lone-hand side switches and brief second hands on distinct frames', () => {
  const frame = (at, handCount, side, capacity = 2) => ({ ...sample(at), mediaTime: at / 1000, handCount, singleHandSide: side, handCapacity: capacity })
  const sides = output.summarizeHandSides([
    frame(0, 1, 'Left'), frame(50, 1, 'Left', 1),
    frame(100, 1, 'Right', 1),            // one hand changed side
    frame(100, 1, 'Left', 1),             // same video frame again: ignored
    frame(150, 2, undefined, 2),          // search frame adds a second hand for one frame
    frame(200, 1, 'Right', 1),
    frame(250, 2, undefined, 2), frame(300, 2, undefined, 2), frame(350, 2, undefined, 2), // a real second hand
    frame(400, 1, 'Right'),
    frame(800, 1, 'Left'),                // after a long gap: not a switch
  ])
  // Both second hands first appeared on a search frame; only the one-frame one is brief.
  assert.deepEqual({ ...sides }, { oneHandFrames: 6, twoHandFrames: 4, oneHandSideSwitches: 1, briefSecondHands: 1, secondHandOnSearch: 2 })
})
