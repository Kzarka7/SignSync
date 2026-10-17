const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { createSignBoundaryDetector } = load(path.resolve(__dirname, '../src/services/landmarks/signBoundaryDetector.ts'))

function frame(t, offset = 0, options = {}) {
  const point = (x, y) => ({ x, y, z: 0, visibility: 1 })
  const hand = (x, dy) => Array.from({ length: 21 }, (_, i) => point(x + (i % 4) * 0.01, 0.75 + dy - i * 0.004))
  return { timestamp: t,
    leftHand: options.missing ? null : hand(0.3, offset),
    rightHand: hand(0.7, options.both ? offset : 0),
    pose: options.noPose ? null : {
      nose: point(0.5, 0.15), leftShoulder: point(0.25, 0.3), rightShoulder: point(0.75, 0.3),
      leftElbow: point(0.25, 0.55), rightElbow: point(0.75, 0.55),
      leftWrist: point(0.3, 0.75 + offset), rightWrist: point(0.7, 0.75 + (options.both ? offset : 0)),
      leftHip: point(0.35, 0.9), rightHip: point(0.65, 0.9),
    } }
}
function gesture(t, start = 1800, holdEnd = 3200) {
  if (t < start || t > holdEnd + 500) return 0
  if (t < start + 500) return -0.25 * (t - start) / 500
  if (t <= holdEnd) return -0.25
  return -0.25 * (1 - (t - holdEnd) / 500)
}
function replay(makeFrame, end = 5500, step = 50) {
  const detector = createSignBoundaryDetector(), events = []
  for (let t = 0; t <= end; t += step) events.push(...detector.push(makeFrame(t)))
  return { detector, events }
}

test('one-handed sign with visible resting second hand captures once with pre-roll', () => {
  const { events } = replay(t => frame(t, gesture(t)))
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'segment')
  assert.ok(events[0].startMs < 1800)
  assert.ok(events[0].endMs >= 3700)
  assert.ok(events[0].decisionMs > events[0].endMs)
})
test('quiet rest with small tracking jitter never triggers a sign', () => {
  const { events } = replay(t => frame(t, Math.sin(t) * 0.0001), 30000)
  assert.equal(events.length, 0)
})
test('a long held posture does not end the capture before return to rest', () => {
  const { detector, events } = replay(t => frame(t, gesture(t, 1800, 5000)), 4800)
  assert.equal(events.length, 0)
  assert.equal(detector.phase, 'recording')
  const completed = []
  for (let t = 4850; t <= 7000; t += 50) completed.push(...detector.push(frame(t, gesture(t, 1800, 5000))))
  assert.equal(completed.length, 1)
  assert.equal(completed[0].type, 'segment')
})
test('separate repetitions with a clear rest produce two captures', () => {
  const { events } = replay(t => frame(t, gesture(t, 1800, 2700) + gesture(t, 4500, 5400)), 7500)
  assert.equal(events.filter(e => e.type === 'segment').length, 2)
})
test('motion and end timing use elapsed time across different frame rates', () => {
  for (const step of [50, 100]) {
    const { events } = replay(t => frame(t, gesture(t), { both: true }), 5500, step)
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'segment')
  }
})
test('hand tracking loss during a sign is discarded rather than treated as an end', () => {
  const { events } = replay(t => frame(t, gesture(t), { missing: t >= 2400 && t <= 3100 }))
  assert.ok(events.some(e => e.type === 'discard' && e.reason === 'hand-tracking-lost'))
  assert.equal(events.filter(e => e.type === 'segment').length, 0)
})
test('pose loss, frame gaps and incomplete recordings cannot produce completed signs', () => {
  const lost = replay(t => frame(t, gesture(t), { noPose: t >= 2400 && t <= 3100 }))
  assert.ok(lost.events.some(e => e.reason === 'pose-tracking-lost'))
  const { detector } = replay(t => frame(t, gesture(t)), 2500)
  assert.equal(detector.push(frame(3000, -0.25))[0].reason, 'frame-gap')
  const partial = replay(t => frame(t, gesture(t)), 2600)
  assert.equal(partial.detector.finish()[0].reason, 'recording-ended-before-rest')
})
test('non-increasing timestamps and invalid settings are rejected', () => {
  const detector = createSignBoundaryDetector()
  detector.push(frame(50))
  assert.throws(() => detector.push(frame(50)), /timestamps/)
  assert.throws(() => createSignBoundaryDetector({ endMs: -1 }), /settings/)
})
test('capture limit discards a gesture held beyond the supported duration', () => {
  const { events } = replay(t => frame(t, gesture(t, 1800, 15000)), 11000)
  assert.ok(events.some(e => e.reason === 'capture-limit'))
  assert.equal(events.filter(e => e.type === 'segment').length, 0)
})

test('finger motion can start capture even when wrists remain still', () => {
  const { events } = replay(t => {
    const sample = frame(t)
    const change = gesture(t)
    for (let i = 1; i < 21; i++) sample.leftHand[i].y += change
    return sample
  })
  assert.equal(events.filter(e => e.type === 'segment').length, 1)
})

test('losing a signing hand at resting wrist height cannot silently complete a sign', () => {
  const { events } = replay(t => {
    const sample = frame(t)
    for (let i = 1; i < 21; i++) sample.leftHand[i].y += gesture(t)
    if (t >= 2400 && t <= 3400) sample.leftHand = null
    return sample
  })
  assert.ok(events.some(e => e.reason === 'hand-tracking-lost'))
  assert.equal(events.filter(e => e.type === 'segment').length, 0)
})

test('offline CLI reads evaluation ZIPs, preserves input and refuses training files', async () => {
  const fs = require('node:fs'), os = require('node:os'), JSZip = require('jszip')
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signsync-boundary-'))
  try {
    const frames = []
    for (let t = 0; t <= 5500; t += 50) frames.push({ timestamp: t, raw: frame(t, gesture(t)) })
    const data = { format: 'signsync-boundary-evaluation', version: 1, purpose: 'evaluation-only', recordings: [{
      id: 'pilot', label: 'HELP', evaluation: { protocol: 'boundary-pilot-v1', taskId: 'HELP-normal' }, frames,
    }] }
    data.recordings.push({ id: 'extra-idle', label: 'NO_SIGN',
      evaluation: { protocol: 'boundary-pilot-v1', taskId: 'no-sign-extra-idle_left_beside_torso' },
      frames: frames.map(f => ({ timestamp: f.timestamp, raw: frame(f.timestamp) })) })
    const zip = new JSZip(); zip.file('evaluation.json', JSON.stringify(data))
    const file = path.join(dir, 'pilot.zip'), report = path.join(dir, 'report.json')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' }); fs.writeFileSync(file, bytes)
    const command = path.resolve(__dirname, '../scripts/replayBoundaryEvaluation.cjs')
    let run = spawnSync(process.execPath, [command, file, report], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    const result = JSON.parse(fs.readFileSync(report, 'utf8'))
    assert.equal(result.recordings[0].detectedCount, 1)
    assert.equal(result.recordings[0].countMatchesTask, true)
    assert.equal(result.recordings[1].expectedCount, 0)
    assert.equal(result.recordings[1].detectedCount, 0)
    assert.equal(result.recordings[1].countMatchesTask, true)
    assert.ok(result.summary.noSignMinutes > 0)
    assert.deepEqual(fs.readFileSync(file), bytes)
    run = spawnSync(process.execPath, [command, file, report], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    fs.writeFileSync(path.join(dir, 'training.json'), JSON.stringify({ schemaVersion: 1, sequences: [] }))
    run = spawnSync(process.execPath, [command, path.join(dir, 'training.json'), path.join(dir, 'wrong.json')], { encoding: 'utf8' })
    assert.notEqual(run.status, 0)
    assert.equal(fs.existsSync(path.join(dir, 'wrong.json')), false)
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
