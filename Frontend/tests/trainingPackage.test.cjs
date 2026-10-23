const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const JSZip = require('jszip')
const crypto = require('node:crypto')
function load(relative) {
  const cache = new Map()
  function at(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText,
      { exports, Blob, TextEncoder, crypto: crypto.webcrypto, require: name => name.startsWith('.') ? at(path.resolve(path.dirname(file), name + '.ts')) : require(name) })
    return exports
  }
  return at(path.resolve(__dirname, '../src', relative + '.ts'))
}
const { assessVideoQuality, assessBoundaryVideoQuality } = load('services/dataset/videoQuality')
const { automaticSignInterval, reviewSignInterval } = load('services/dataset/videoDiagnostics')
const { assessTrainingSample, reviewTrainingSamples, buildTrainingPackage } = load('services/dataset/trainingPackage')
const { suggestSignInterval, videoDiagnostics } = load('services/dataset/videoDiagnostics')
const { confirmInterval, intervalReviewMatches, intervalFindings } = load('services/dataset/videoIntervalReview')
const { sourceFrameSelector } = load('services/dataset/frameTiming')
function fixture() {
  const p = { x: .5, y: .5, z: 0, visibility: 1 }
  const frames = Array.from({ length: 20 }, (_, i) => {
    const pose = Object.fromEntries(['nose','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip'].map(key => [key, { ...p }]))
    pose.leftShoulder.x = .35; pose.rightShoulder.x = .65
    return { timestamp: i * 50, raw: { timestamp: i * 50, pose, leftHand: Array.from({ length: 21 }, () => ({ ...p, visibility: 0 })), rightHand: null } }
  })
  return { id: 'sample-1', label: 'THANK_YOU', createdAt: '2026-10-21T00:00:00Z', durationMs: 950, frames,
    videoImport: { kind: 'video-upload', filename: 'test.mp4', fingerprint: 'a'.repeat(64), trimStartMs: 500, trimEndMs: 1500, sourceDurationMs: 2000,
      width: 1920, height: 1080, inputWidth: 640, inputHeight: 360, maxDimension: 640, sampleFps: 20, processingVersion: 'video-import-v3-mp0.10.35-20fps',
      expectedHands: 'either', reviewedAt: '2026-10-21T00:00:00Z', quality: assessVideoQuality(frames),
      preprocessing: { orientation: 'browser-displayed', mirroring: 'source-unchanged', handedness: 'mediapipe-assignment', missingHands: 'null-with-presence-flags', interpolation: 'none' },
      review: { protocol: 'video-training-review-v1', label: 'THANK_YOU', trimStartMs: 500, trimEndMs: 1500, processingVersion: 'video-import-v3-mp0.10.35-20fps', expectedHands: 'either', completeSign: true, qualityFindingsAccepted: true } } }
}

function boundaryFixture(purpose = 'idle_movement') {
  const sample = fixture(), meta = sample.videoImport
  sample.label = purpose === 'rest' ? 'REST' : 'IDLE_MOVEMENT'
  sample.training = { protocol: 'separate-training-v1', category: purpose, taskId: purpose === 'rest' ? 'rest-idle_both_in_front' : 'idle-movement-lap', taskTitle: 'Non-sign task' }
  for (const frame of sample.frames) {
    frame.raw.leftHand = frame.raw.rightHand = null
    frame.sourceTimestampMs = meta.trimStartMs + frame.timestamp; frame.sourceDurationMs = 50
  }
  meta.processingVersion = 'video-import-v6-mp0.10.35-boundary'; meta.samplePurpose = purpose
  meta.preprocessing.orientation = 'source-display-transform'
  meta.sampling = { method: 'decoded-source-frames-v1', requestedFps: 30, effectiveTargetFps: 20, sourceAverageFps: 20, sourceMedianFps: 20,
    variableFrameRate: false, sourceTimeOriginSeconds: 0, achievedFps: 20, decodedFrames: 20, selectedFrames: 20, skippedForTarget: 0,
    duplicateTimestamps: 0, processingMs: 1000, processingFps: 20 }
  meta.intervalReview = confirmInterval(.5, 1.5, 2)
  meta.quality = assessBoundaryVideoQuality(sample.frames, purpose, 'either', { endMs: 1000, fps: 20 })
  meta.review = { ...meta.review, label: sample.label, processingVersion: meta.processingVersion, samplePurpose: purpose,
    training: { ...sample.training }, completeSample: true }
  delete meta.review.completeSign
  return sample
}

test('non-sign quality preserves intentional missing hands without permitting missing body observations', () => {
  const idle = boundaryFixture()
  assert.equal(idle.videoImport.quality.result, 'Pass')
  assert.equal(idle.videoImport.quality.usableFrames, 20)
  assert.equal(assessVideoQuality(idle.frames).result, 'Retake', 'sign policy remains strict')
  assert.equal(boundaryFixture('rest').videoImport.quality.result, 'Review', 'rest posture visibility still needs review')
  for (const frame of idle.frames) frame.raw.pose = null
  assert.equal(assessBoundaryVideoQuality(idle.frames, 'idle_movement', 'either', { endMs: 1000, fps: 20 }).result, 'Retake')
})

test('boundary training export binds task/category approval and retains raw null hands', async () => {
  const sample = boundaryFixture()
  assert.equal(assessTrainingSample(sample).state, 'Ready for training')
  const pkg = await buildTrainingPackage([sample]), archive = await JSZip.loadAsync(await pkg.blob.arrayBuffer())
  const data = JSON.parse(await archive.file('dataset.json').async('string'))
  assert.equal(data.sequences[0].frames[0].raw.leftHand, null)
  assert.equal(data.sequences[0].frames[0].features[36], 0)
  assert.equal(data.sequences[0].training.taskId, sample.training.taskId)
  if (process.env.BOUNDARY_PACKAGE_FIXTURE) fs.writeFileSync(process.env.BOUNDARY_PACKAGE_FIXTURE, Buffer.from(await pkg.blob.arrayBuffer()))
  for (const change of [s => s.training.taskId = 'idle-movement-hair', s => s.videoImport.samplePurpose = 'rest',
    s => s.videoImport.review.completeSample = false, s => s.videoImport.processingVersion = 'video-import-v5-mp0.10.35-gesture-context',
    s => s.videoImport.qualityWindow = { protocol: 'gesture-context-v1', basis: 'automatic-hand-activity', startMs: 250, endMs: 750 }]) {
    const changed = boundaryFixture(); change(changed)
    assert.notEqual(assessTrainingSample(changed).state, 'Ready for training')
  }
})
test('readiness requires matching human approval and current processing; old samples are preserved', () => {
  const sample = fixture()
  assert.equal(assessTrainingSample(sample).state, 'Ready for training')
  delete sample.videoImport.review
  assert.equal(assessTrainingSample(sample).state, 'Needs review')
  assert.equal(sample.frames.length, 20)
  for (const change of [s => s.label = 'HELLO', s => s.videoImport.trimStartMs = 400, s => s.videoImport.expectedHands = 'both', s => s.videoImport.processingVersion = 'video-import-v2-old']) {
    const changed = fixture(); change(changed)
    assert.notEqual(assessTrainingSample(changed).state, 'Ready for training')
  }
})

test('boundary confirmation binds the interval and choice without rejecting legacy exports', () => {
  const sample = fixture()
  const review = confirmInterval(.5, 1.5, 2)
  sample.videoImport.intervalReview = review
  assert.equal(review.choice, 'selected-interval')
  assert.equal(intervalReviewMatches(review, .5, 1.5, 2), true)
  assert.equal(assessTrainingSample(sample).state, 'Ready for training')
  review.endMs = 1600
  assert.match(assessTrainingSample(sample).reasons.join(' '), /boundary confirmation/)
  assert.equal(confirmInterval(0, 2, 2).choice, 'full-recording')
  delete sample.videoImport.intervalReview
  assert.equal(assessTrainingSample(sample).state, 'Ready for training')
  assert.match(assessTrainingSample(sample).warnings.join(' '), /Older sample/)
})

test('jump findings use source times and distinguish inside, outside and crossing gaps', () => {
  const frames = fixture().frames
  for (const i of [0, 1, 2, 17, 18, 19]) frames[i].raw.leftHand = null
  frames[8].raw.leftHand[0].x = .99
  const findings = intervalFindings(frames, 1, 2, 1.1, 1.8, 'either')
  assert.equal(findings.find(item => item.start === 1).location, 'Crosses interval boundary')
  assert.equal(findings.find(item => item.kind === 'edge').location, 'Inside selected interval')
  assert.equal(findings.find(item => item.start === 1.85).location, 'Outside selected interval')
})
test('bad timing, non-finite raw data, malformed hands and false quality cannot enter training', () => {
  for (const change of [s => s.frames[5].timestamp = 0, s => s.frames[5].raw.leftHand[0].x = NaN, s => s.frames[5].raw.leftHand.pop(), s => s.videoImport.trimEndMs = 1000, s => s.durationMs = 1]) {
    const sample = fixture(); change(sample)
    assert.notEqual(assessTrainingSample(sample).state, 'Ready for training')
  }
  const sample = fixture(); sample.videoImport.quality.usableFrames = 0
  assert.match(assessTrainingSample(sample).reasons.join(' '), /Stored quality/)
})
test('both-hand expectation adds a review finding without imposing it on one-handed signs', () => {
  const sample = fixture()
  assert.equal(assessVideoQuality(sample.frames).result, 'Pass')
  assert.match(assessVideoQuality(sample.frames, 'both').findings.join(' '), /Both hands are expected/)
})
test('suggestions preserve short detections and margins, never classify hidden hands as rest', () => {
  const frames = fixture().frames
  assert.equal(suggestSignInterval(frames, 1.000211).end, 1.000211, 'a full-clip suggestion preserves the exact source endpoint')
  for (let i = 0; i < 5; i++) frames[i].raw.leftHand = null
  for (let i = 15; i < 20; i++) frames[i].raw.leftHand = null
  const suggestion = suggestSignInterval(frames, 1)
  assert.equal(suggestion.start, 0); assert.equal(suggestion.end, 1)
  assert.equal(suggestion.movingFrames, 0, 'stationary signs are allowed')
  assert.equal(videoDiagnostics(frames).filter(tick => tick.left).length, 10)
  frames.forEach(frame => frame.raw.leftHand = null)
  assert.equal(suggestSignInterval(frames, 1), null)
})
test('package excludes duplicate sources/content and evaluation samples with specific reasons', async () => {
  const first = fixture(), duplicate = fixture(), evaluation = fixture()
  duplicate.id = 'sample-2'; evaluation.id = 'sample-3'; evaluation.evaluation = { taskId: 'held-out' }
  const report = reviewTrainingSamples([first, duplicate, evaluation])
  assert.equal(report.filter(item => item.state === 'Ready for training').length, 1)
  assert.match(report[1].reasons.join(' '), /Duplicate source/)
  assert.match(report[2].reasons.join(' '), /evaluation/)
  const pkg = await buildTrainingPackage([first, duplicate, evaluation])
  assert.equal(pkg.report.included, 1); assert.equal(pkg.report.excluded, 2)
  const archive = await JSZip.loadAsync(await pkg.blob.arrayBuffer())
  const checksums = JSON.parse(await archive.file('checksums.json').async('string'))
  for (const [name, expected] of Object.entries(checksums)) assert.equal(crypto.createHash('sha256').update(await archive.file(name).async('nodebuffer')).digest('hex'), expected)
  const data = JSON.parse(await archive.file('dataset.json').async('string'))
  assert.equal(data.featureSchema.length, 164)
  assert.equal(data.sequences[0].frames[0].raw.rightHand, null)
  assert.equal(data.sequences[0].frames[0].features[data.featureSchema.order.indexOf('rightHand.present')], 0)
  assert.match(await archive.file('manifest.json').async('string'), /unknown/)
  // Optional fixture output for the actual Python loader smoke check.
  if (process.env.TRAINING_PACKAGE_FIXTURE) fs.writeFileSync(process.env.TRAINING_PACKAGE_FIXTURE, Buffer.from(await pkg.blob.arrayBuffer()))
})

test('source-frame v4 exports retain irregular real timestamps and pass training approval', async () => {
  const sample = fixture(), meta = sample.videoImport
  const original = sample.frames[0].raw
  sample.frames = Array.from({ length: 30 }, (_, i) => {
    const timestamp = 10 + i * 1000 / 29.97
    const raw = JSON.parse(JSON.stringify(original)); raw.timestamp = timestamp
    return { timestamp, raw, sourceTimestampMs: 500 + timestamp, sourceDurationMs: 1000 / 29.97 }
  })
  sample.durationMs = sample.frames.at(-1).timestamp - sample.frames[0].timestamp
  meta.processingVersion = meta.review.processingVersion = 'video-import-v4-mp0.10.35-source-frames'
  meta.preprocessing.orientation = 'source-display-transform'
  meta.sampleFps = 29.97
  meta.sampling = { method: 'decoded-source-frames-v1', requestedFps: 60, effectiveTargetFps: 29.97, sourceAverageFps: 29.97, sourceMedianFps: 29.97,
    variableFrameRate: false, sourceTimeOriginSeconds: 0, achievedFps: 29.97, decodedFrames: 30, selectedFrames: 30, skippedForTarget: 0,
    duplicateTimestamps: 0, processingMs: 1000, processingFps: 30 }
  meta.quality = assessVideoQuality(sample.frames, 'either', { endMs: 1000, fps: 29.97 })
  assert.equal(assessTrainingSample(sample).state, 'Ready for training')
  const pkg = await buildTrainingPackage([sample]), archive = await JSZip.loadAsync(await pkg.blob.arrayBuffer())
  const exported = JSON.parse(await archive.file('dataset.json').async('string')).sequences[0]
  assert.equal(exported.frames[0].timestamp, 10)
  assert.equal(exported.frames[0].sourceTimestampMs, 510)
  if (process.env.SOURCE_PACKAGE_FIXTURE) fs.writeFileSync(process.env.SOURCE_PACKAGE_FIXTURE, Buffer.from(await pkg.blob.arrayBuffer()))
  meta.sampling.achievedFps = 60
  assert.notEqual(assessTrainingSample(sample).state, 'Ready for training')
})

test('source selection rejects duplicate timestamps and never fabricates low-rate frames', () => {
  const selector = sourceFrameSelector(60, 0, 1)
  assert.equal(selector.accept(0), true)
  assert.equal(selector.accept(0), false)
  assert.equal(selector.accept(1 / 30), true)
  assert.equal(selector.accept(1), false, 'end is exclusive')
  assert.equal(selector.stats().duplicateTimestamps, 1)
  assert.throws(() => selector.accept(.01), /presentation order/)
})

test('tracking-gap durations stay equal across 20, 30 and 60 FPS', () => {
  for (const fps of [20, 30, 60]) {
    const raw = fixture().frames[0].raw
    const frames = Array.from({ length: fps * 2 }, (_, i) => {
      const timestamp = i * 1000 / fps, value = JSON.parse(JSON.stringify(raw)); value.timestamp = timestamp
      if (timestamp >= 200 && timestamp < 500) value.leftHand = null
      return { timestamp, raw: value }
    })
    const result = assessVideoQuality(frames, 'either', { endMs: 2000, fps })
    assert.ok(Math.abs(result.longestGapMs - 300) < .001)
  }
})

test('automatic boundaries keep margins and defer stationary, fragmented or boundary-reaching activity', () => {
  const template = fixture().frames[0]
  const frames = Array.from({ length: 100 }, (_, i) => {
    const frame = JSON.parse(JSON.stringify(template))
    frame.timestamp = frame.raw.timestamp = i * 50
    if (i < 20 || i > 50) frame.raw.leftHand = null
    else for (const point of frame.raw.leftHand) point.x += Math.sin(i) * .05
    return frame
  })
  const suggested = automaticSignInterval(frames, 5)
  assert.equal(suggested.start, .75)
  assert.equal(suggested.end, 2.8)
  const stationary = JSON.parse(JSON.stringify(frames))
  stationary.forEach(frame => { if (frame.raw.leftHand) frame.raw.leftHand = template.raw.leftHand })
  assert.equal(automaticSignInterval(stationary, 5), null)
  const split = JSON.parse(JSON.stringify(frames))
  split.forEach((frame, i) => { if (i > 25 && i < 45) frame.raw.leftHand = null })
  assert.equal(automaticSignInterval(split, 5), null)
  assert.equal(automaticSignInterval(frames.slice(20).map(frame => ({ ...frame, timestamp: frame.timestamp - 1000 })), 4), null)
})

function repeatedSignFrames(fps = 30, ranges = [[1000, 2000], [3000, 4200]]) {
  const template = fixture().frames[0]
  return Array.from({ length: fps * 5 }, (_, i) => {
    const frame = JSON.parse(JSON.stringify(template)), t = i * 1000 / fps
    frame.timestamp = frame.raw.timestamp = t
    const active = ranges.some(([start, end]) => t >= start && t < end)
    const pose = frame.raw.pose
    pose.leftShoulder.y = pose.rightShoulder.y = .3
    pose.leftHip.y = pose.rightHip.y = .8
    pose.leftWrist.y = active ? .45 : .9
    pose.rightWrist.y = .9
    frame.raw.leftHand.forEach(point => { point.y = pose.leftWrist.y; point.x = .5 + (active ? Math.sin(t / 100) * .05 : 0) })
    return frame
  })
}

test('auto-trim selects only the first complete idle-bounded activity at different frame rates', () => {
  for (const fps of [20, 30, 60]) {
    const interval = automaticSignInterval(repeatedSignFrames(fps), 5)
    assert.ok(interval, `expected interval at ${fps} FPS`)
    assert.ok(Math.abs(interval.start - .75) < .06)
    assert.ok(interval.end > 2 && interval.end < 2.5, 'completion margin stays before second performance')
    assert.ok(interval.activityStartMs >= 1000 && interval.activityEndMs < 2500)
    assert.match(interval.reason, /first usable activity/)
  }
})

test('raised-hand holds, brief pauses and uncertain tracking do not separate performances', () => {
  const raised = repeatedSignFrames(30, [[1000, 4200]])
  raised.forEach(frame => {
    if (frame.timestamp >= 2000 && frame.timestamp < 3000) frame.raw.leftHand.forEach(point => { point.x = .5 })
  })
  assert.equal(automaticSignInterval(raised, 5).activityEndMs > 4000, true, 'a raised hold is not treated as idle; manual trimming is needed for repetitions')
  const brief = repeatedSignFrames(30, [[1000, 2000], [2200, 4200]])
  assert.ok(automaticSignInterval(brief, 5).activityEndMs > 4000, 'a short dip does not split a sign')
  const lost = repeatedSignFrames()
  lost.forEach(frame => {
    if (frame.timestamp >= 2000 && frame.timestamp < 3000) {
      frame.raw.leftHand = null
      frame.raw.pose.leftWrist.visibility = .1
    }
  })
  assert.equal(automaticSignInterval(lost, 5), null, 'missing hands with unreliable pose never prove idle')
})

test('auto-trim skips a cut-off first performance and defers when no complete interval exists', () => {
  const cutFirst = repeatedSignFrames(30, [[0, 1500], [3000, 4200]])
  const interval = automaticSignInterval(cutFirst, 5)
  assert.ok(interval.start > 2.5 && interval.end < 5)
  const cutBoth = repeatedSignFrames(30, [[0, 1500], [3000, 5000]])
  assert.equal(automaticSignInterval(cutBoth, 5), null)
})

test('auto-trim does not split when only one arm returns to rest', () => {
  const frames = repeatedSignFrames()
  frames.forEach(frame => {
    if (frame.timestamp >= 2000 && frame.timestamp < 3000) frame.raw.pose.rightWrist.y = .45
  })
  assert.ok(automaticSignInterval(frames, 5).activityEndMs > 4000)
})

test('one-hand trimming tolerates hidden hips and an unseen unused arm', () => {
  const frames = repeatedSignFrames(25, [[920, 1600], [2240, 3000]])
  frames.forEach(frame => {
    const pose = frame.raw.pose
    pose.leftHip.visibility = pose.rightHip.visibility = .1
    pose.rightWrist.visibility = .1
    if (frame.timestamp < 920 || frame.timestamp >= 1600 && frame.timestamp < 2240) frame.raw.leftHand = null
  })
  const interval = automaticSignInterval(frames, 3)
  assert.ok(interval)
  assert.ok(interval.start < 1 && interval.end < 2.24)
  assert.ok(interval.activityEndMs < 1800)
})

test('review retains a start-trim suggestion when continuous repeated signing reaches the end', () => {
  const frames = repeatedSignFrames(30, [[1000,5000]])
  frames.forEach(frame => {
    if (frame.timestamp < 1000) frame.raw.leftHand = null
  })
  assert.equal(automaticSignInterval(frames,5).end,5, 'leading idle is trimmed automatically while preserving the ending')
  const suggestion = reviewSignInterval(frames,5)
  assert.equal(suggestion.start,.75)
  assert.equal(suggestion.end,5, 'the user chooses the end between repetitions')
  assert.match(suggestion.reason,/adjust the end manually/)
  assert.equal(reviewSignInterval([],5),null)
})

test('ONE_6 actual-video landmarks select the first sign despite cropped resting wrists', () => {
  const data = require('./fixtures/one6Landmarks.json')
  const frames = data.frames.map(([timestamp, pose, left, right]) => {
    const point = ([x,y,z,visibility]) => ({ x,y,z,visibility })
    return { timestamp, raw: { timestamp,
      pose: Object.fromEntries(data.poseNames.map((name,i) => [name,point(pose[i])])),
      leftHand: left?.map(point) ?? null, rightHand: right?.map(point) ?? null } }
  })
  assert.equal(suggestSignInterval(frames,data.duration).end, 3, 'old all-activity suggestion includes both performances')
  const interval = automaticSignInterval(frames,data.duration)
  assert.ok(interval)
  assert.equal(interval.start, .67)
  assert.equal(interval.end, 1.97)
  assert.equal(reviewSignInterval(frames,data.duration).end,1.97, 'review prefers the first complete performance over the outer trim')
  const selected = frames.filter(f => f.timestamp >= interval.start*1000 && f.timestamp < interval.end*1000)
    .map(f => ({ ...f,timestamp:f.timestamp-interval.start*1000 }))
  const quality = assessVideoQuality(selected,'either', { endMs:(interval.end-interval.start)*1000,fps:25 },
    { protocol:'gesture-context-v1',basis:'automatic-hand-activity',startMs:interval.activityStartMs-interval.start*1000,endMs:interval.activityEndMs-interval.start*1000 })
  assert.notEqual(quality.result,'Retake')
  const unknown = JSON.parse(JSON.stringify(frames))
  unknown.forEach(frame => { if (!frame.raw.leftHand) frame.raw.pose.leftElbow.visibility = .1 })
  assert.equal(automaticSignInterval(unknown,data.duration),null, 'hidden wrists without reliable lower-arm evidence still defer')
})

test('v5 preserves context frames and binds training approval to gesture boundaries', async () => {
  const sample = fixture(), meta = sample.videoImport
  sample.frames.forEach((frame, i) => {
    frame.sourceTimestampMs = 500 + frame.timestamp; frame.sourceDurationMs = 50
    if (i < 4 || i >= 16) frame.raw.leftHand = null
  })
  meta.processingVersion = meta.review.processingVersion = 'video-import-v5-mp0.10.35-gesture-context'
  meta.preprocessing.orientation = 'source-display-transform'
  meta.qualityWindow = { protocol: 'gesture-context-v1', basis: 'automatic-hand-activity', startMs: 200, endMs: 800 }
  meta.review.qualityWindow = { ...meta.qualityWindow }
  meta.sampling = { method: 'decoded-source-frames-v1', requestedFps: 20, effectiveTargetFps: 20, sourceAverageFps: 20, sourceMedianFps: 20,
    variableFrameRate: false, sourceTimeOriginSeconds: 0, achievedFps: 20, decodedFrames: 20, selectedFrames: 20, skippedForTarget: 0,
    duplicateTimestamps: 0, processingMs: 1000, processingFps: 20 }
  meta.quality = assessVideoQuality(sample.frames, 'either', { endMs: 1000, fps: 20 }, meta.qualityWindow)
  assert.equal(meta.quality.result, 'Pass')
  assert.equal(assessTrainingSample(sample).state, 'Ready for training')
  const pkg = await buildTrainingPackage([sample])
  if (process.env.CONTEXT_PACKAGE_FIXTURE) fs.writeFileSync(process.env.CONTEXT_PACKAGE_FIXTURE, Buffer.from(await pkg.blob.arrayBuffer()))
  meta.qualityWindow.startMs = 250
  assert.match(assessTrainingSample(sample).reasons.join(' '), /assessment boundaries/)
})
