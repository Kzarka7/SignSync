const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(relative, mocks = {}, globals = {}) {
  const cache = new Map()
  function moduleAt(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    vm.runInNewContext(code, { exports, console, setTimeout, clearTimeout, DOMException, ...globals,
      require: name => name in mocks ? mocks[name] : name.startsWith('.') ? moduleAt(path.resolve(path.dirname(file), name + '.ts')) : require(name),
    })
    return exports
  }
  return moduleAt(path.resolve(__dirname, '../src', relative + '.ts'))
}
function sample(timestamp = 0) {
  const point = { x: .5, y: .5, z: 0, visibility: 1 }
  const pose = Object.fromEntries(['nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist', 'leftHip', 'rightHip'].map(key => [key, { ...point }]))
  pose.leftShoulder.x = .35; pose.rightShoulder.x = .65
  return { timestamp, raw: { timestamp, pose, leftHand: Array.from({ length: 21 }, () => ({ ...point })), rightHand: null } }
}
const { assessVideoQuality } = load('services/dataset/videoQuality')
test('coverage distinguishes missing hands from rest and allows a single hand', () => {
  const frames = Array.from({ length: 20 }, (_, i) => sample(i * 50))
  for (const i of [0, 1, 18, 19]) frames[i].raw.leftHand = null
  const quality = assessVideoQuality(frames)
  assert.equal(quality.coverage.leftHandFrames, 16)
  assert.equal(quality.coverage.rightHandFrames, 0)
  assert.equal(quality.coverage.noHandsFrames, 4)
  assert.equal(JSON.stringify(quality.coverage.noHandIntervalsMs), JSON.stringify([{ start: 0, end: 100 }, { start: 900, end: 1000 }]))
  const selected = frames.slice(2, 18).map(frame => ({ ...frame, timestamp: frame.timestamp - 100 }))
  assert.equal(assessVideoQuality(selected).result, 'Pass')
})
test('preview follows source and stored timestamps without filling tracking gaps', () => {
  const { previewFrame } = load('services/dataset/videoPreview')
  const frames = [sample(0), sample(50), sample(500)]
  assert.equal(previewFrame(frames, 1.05, 1, 2), frames[1])
  assert.equal(previewFrame(frames, 1.3, 1, 2), null)
  assert.equal(previewFrame(frames, .99, 1, 2), null)
  assert.equal(previewFrame(frames, 2, 1, 2), null)
})
test('preview draws finger connections only for detected hands', () => {
  const { drawVideoLandmarks } = load('services/dataset/videoPreview')
  let lines = 0, points = 0
  const ctx = { beginPath() {}, moveTo() {}, lineTo() { lines++ }, stroke() {}, arc() { points++ }, fill() {} }
  const raw = sample().raw; raw.pose = null
  raw.leftHand.forEach(point => { point.visibility = 0 })
  drawVideoLandmarks(ctx, raw, 640, 360)
  assert.equal(lines, 21); assert.equal(points, 21)
  raw.leftHand = null; lines = 0; points = 0
  drawVideoLandmarks(ctx, raw, 640, 360)
  assert.equal(lines, 0); assert.equal(points, 0)
})
test('one-handed stationary signs pass technical checks without a classifier', () => {
  const quality = assessVideoQuality(Array.from({ length: 21 }, (_, i) => sample(i * 50)))
  assert.equal(quality.result, 'Pass'); assert.equal(quality.usableFrames, 21)
})
test('insufficient data is Retake; gaps, weak shoulders, and clipping require Review', () => {
  assert.equal(assessVideoQuality([]).result, 'Retake')
  assert.equal(assessVideoQuality([sample()]).result, 'Retake')
  const frames = Array.from({ length: 40 }, (_, i) => sample(i * 50))
  for (let i = 10; i < 20; i++) frames[i].raw.leftHand = null
  let quality = assessVideoQuality(frames)
  assert.equal(quality.result, 'Review'); assert.equal(quality.longestGapMs, 500)
  const clipped = Array.from({ length: 20 }, (_, i) => sample(i * 50))
  clipped[5].raw.leftHand[0].x = .99
  assert.equal(assessVideoQuality(clipped).result, 'Review')
  for (const frame of clipped) frame.raw.pose.leftShoulder.visibility = .1
  assert.equal(assessVideoQuality(clipped).result, 'Retake')
})
test('internal loss of one hand is flagged even while the other remains visible', () => {
  const frames = Array.from({ length: 40 }, (_, i) => sample(i * 50))
  for (const frame of frames) frame.raw.rightHand = sample().raw.leftHand
  for (let i = 10; i < 20; i++) frames[i].raw.leftHand = null
  assert.equal(assessVideoQuality(frames).result, 'Review')
})
test('saved uploads retain metadata through JSON and ZIP exports and reject duplicate source files', async () => {
  const storage = load('services/dataset/datasetStorage', {}, { indexedDB: new (require('fake-indexeddb').IDBFactory)(), localStorage: { getItem: () => null } })
  const seq = { id: 'import-1', label: 'HELLO', createdAt: new Date().toISOString(), durationMs: 1000,
    frames: Array.from({ length: 21 }, (_, i) => sample(i * 50)),
    videoImport: { kind: 'video-upload', participantId: 'P1', fingerprint: 'abc', filename: 'phone.mov', trimStartMs: 500, trimEndMs: 1550,
      processingVersion: 'test', quality: { result: 'Pass' } } }
  await storage.saveSequence(seq)
  await assert.rejects(() => storage.saveSequence({ ...seq, id: 'different', label: 'NO' }), /already been saved/)
  const exporter = load('services/dataset/datasetExport')
  const exported = exporter.buildDatasetExport((await storage.getSequences()))
  assert.equal(exported.sequences[0].videoImport.participantId, 'P1')
  assert.equal(exported.sequences[0].videoImport.trimStartMs, 500)
  assert.equal(exported.sequences[0].frames[0].features.length, 164)
  const zip = await exporter.buildPerSampleZipExport((await storage.getSequences()))
  const archive = await require('jszip').loadAsync(await zip.blob.arrayBuffer())
  const entry = Object.values(archive.files)[0]
  assert.equal(JSON.parse(await entry.async('string')).sequences[0].videoImport.fingerprint, 'abc')
})
function processorFixture(sourceFps = 60, origin = 0, medianFps = sourceFps) {
  let closed = 0, revoked = 0
  const timestamps = [], seeks = []
  const model = { detectForVideo: (_, t) => { timestamps.push(t); return {} }, close: () => { closed++ } }
  const processor = load('services/dataset/videoImport', {
    '@mediapipe/tasks-vision': { FilesetResolver: { forVisionTasks: async () => ({}) } },
    '../landmarks/visionRuntime': { WASM_BASE_URL: '', createHandLandmarker: async () => model,
      createPoseLandmarker: async () => model, buildFrameSample: timestamp => sample(timestamp).raw },
    './sourceVideo': { openSourceVideo: async () => ({ duration: 2 + origin, width: 1080, height: 1920, origin,
      metrics: { medianFrameRate: medianFps, averageFrameRate: sourceFps, underlyingFrameRate: sourceFps },
      canvases: async function* (start, end) {
        for (let i = Math.max(0, Math.ceil((start - origin) * sourceFps - 1e-8)); origin + i / sourceFps < end - 1e-8; i++) {
          seeks.push(origin + i / sourceFps)
          yield { timestamp: origin + i / sourceFps, duration: 1 / sourceFps, canvas: { width: 360, height: 640 } }
        }
      }, dispose: () => revoked++,
    }) },
  }, { performance })
  return { ...processor, timestamps, seeks, closed: () => closed, revoked: () => revoked }
}
test('trimmed processing uses source times, relative sample timestamps, and displayed portrait dimensions', async () => {
  const fixture = processorFixture()
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: .5, end: 1.5 }, { targetFps: 20 })
  assert.equal(result.frames.length, 20)
  assert.ok(Math.abs(result.frames[0].timestamp) < .001)
  assert.ok(Math.abs(result.frames[19].timestamp - 950) < .001)
  assert.equal(fixture.seeks[0], .5)
  assert.equal(result.width, 1080); assert.equal(result.height, 1920)
  assert.equal(fixture.closed(), 2); assert.equal(fixture.revoked(), 1)
})
test('cancellation releases both tracking models and the source decoder', async () => {
  const fixture = processorFixture(), controller = new AbortController()
  await assert.rejects(fixture.processVideo({}, controller.signal, () => controller.abort()), { name: 'AbortError' })
  assert.equal(fixture.closed(), 2); assert.equal(fixture.revoked(), 1)
})
test('fractional trim endpoints stay exclusive despite floating-point rounding', async () => {
  const fixture = processorFixture()
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: .1, end: .8 }, { targetFps: 20 })
  assert.equal(result.frames.length, 14)
  assert.ok(Math.abs(result.frames.at(-1).timestamp - 650) < .001)
  assert.ok(fixture.seeks.every(time => time < .8))
})
test('invalid intervals fail before tracking starts and release the source decoder', async () => {
  const fixture = processorFixture()
  await assert.rejects(fixture.processVideo({}, new AbortController().signal, () => {}, { start: 1, end: .5 }), /valid interval/)
  assert.equal(fixture.closed(), 0); assert.equal(fixture.revoked(), 1)
})

test('60 target FPS on a 30 FPS source retains real source rate without invented frames', async () => {
  const fixture = processorFixture(30)
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: 0, end: 1 }, { targetFps: 60 })
  assert.equal(result.frames.length, 30)
  assert.ok(Math.abs(result.sampling.achievedFps - 30) < .001)
  assert.equal(result.sampling.requestedFps, 60)
  assert.equal(new Set(result.frames.map(frame => frame.sourceTimestampMs)).size, 30)
})

test('default 30 FPS on a 60 FPS source selects 30 distinct observations', async () => {
  const fixture = processorFixture()
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: 0, end: 1 })
  assert.equal(result.frames.length, 30)
  assert.equal(result.sampling.decodedFrames, 60)
  assert.equal(result.sampling.skippedForTarget, 30)
  assert.ok(Math.abs(result.sampling.achievedFps - 30) < .001)
})

test('non-zero phone PTS stays aligned with the native video timeline', async () => {
  const fixture = processorFixture(30, .0899)
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: 0, end: 1 })
  assert.ok(Math.abs(result.frames[0].timestamp - 89.9) < .001)
  assert.ok(Math.abs(result.frames[0].sourceTimestampMs - 89.9) < .001)
  assert.equal(result.sampling.sourceTimeOriginSeconds, .0899)
})

test('trim quality uses the exact millisecond interval persisted in metadata', async () => {
  const fixture = processorFixture()
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: .2, end: 1.55 })
  const { assessVideoQuality } = load('services/dataset/videoQuality')
  assert.deepEqual(JSON.parse(JSON.stringify(result.quality)), JSON.parse(JSON.stringify(assessVideoQuality(result.frames, 'either',
    { endMs: result.end * 1000 - result.start * 1000, fps: result.sampling.effectiveTargetFps }))))
})

test('near-target camera jitter retains distinct source observations', () => {
  const { sourceFrameSelector } = load('services/dataset/frameTiming')
  const selector = sourceFrameSelector(30, 0, 1, true)
  const timestamps = [0, .034, .065, .101, .132, .167]
  assert.equal(timestamps.filter(timestamp => selector.accept(timestamp)).length, timestamps.length)
  assert.equal(selector.accept(.167), false)
  assert.equal(selector.stats().duplicateTimestamps, 1)
  assert.equal(selector.stats().skippedForTarget, 0)
})

test('low-average variable-rate camera preserves frames despite a faster median cadence', async () => {
  const fixture = processorFixture(25, 0, 60)
  const result = await fixture.processVideo({}, new AbortController().signal, () => {}, { start: 0, end: 1 })
  assert.equal(result.frames.length, 25)
  assert.equal(result.sampling.skippedForTarget, 0)
})

test('context margins stay saved but do not count as gesture tracking loss', () => {
  const frames = Array.from({ length: 30 }, (_, i) => sample(i * 50))
  frames.forEach((frame, i) => { if (i < 5 || i >= 25) frame.raw.leftHand = null })
  const timing = { endMs: 1500, fps: 20 }
  const window = { protocol: 'gesture-context-v1', basis: 'automatic-hand-activity', startMs: 250, endMs: 1250 }
  const before = JSON.stringify(frames)
  const quality = assessVideoQuality(frames, 'either', timing, window)
  assert.equal(assessVideoQuality(frames, 'either', timing).result, 'Review')
  assert.equal(quality.result, 'Pass')
  assert.equal(quality.totalFrames, 30)
  assert.equal(quality.gesture.totalFrames, 20)
  assert.equal(quality.context.noHandFrames, 10)
  assert.equal(JSON.stringify(frames), before)
  assert.equal(assessVideoQuality(frames, 'both', timing, window).result, 'Review')
})

test('internal gesture loss and context clipping remain warnings; inadequate gesture data remains Retake', () => {
  const timing = { endMs: 1500, fps: 20 }
  const window = { protocol: 'gesture-context-v1', basis: 'automatic-hand-activity', startMs: 250, endMs: 1250 }
  const frames = Array.from({ length: 30 }, (_, i) => sample(i * 50))
  for (let i = 10; i < 16; i++) frames[i].raw.leftHand = null
  let quality = assessVideoQuality(frames, 'either', timing, window)
  assert.equal(quality.result, 'Review')
  assert.ok(quality.gesture.longestGapMs >= 300)
  frames[0].raw.leftHand[0].x = .99
  quality = assessVideoQuality(frames, 'either', timing, window)
  assert.match(quality.findings.join(' '), /image edge/)
  for (let i = 5; i < 25; i++) frames[i].raw.leftHand = null
  assert.equal(assessVideoQuality(frames, 'either', timing, window).result, 'Retake')
  assert.throws(() => assessVideoQuality(frames, 'either', timing, { ...window, startMs: 500 }), /boundaries/)
})
