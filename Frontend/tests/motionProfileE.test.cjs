const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { assessSignMotion, resolveSignByMotion, resolveStillWordAfterWord, hasConfusableFingerChange, MOTION_E_SETTINGS } = load(path.resolve('src/services/landmarks/signMotionEvidence.ts'))
const { findVisibleSignTransition, TEN_DEPARTURE, WORD_SETTLE } = load(path.resolve('src/services/landmarks/gestureSegmentation.ts'))

function feature(t) {
  const features = Array(164).fill(0); features[36] = 1; features[7] = features[11] = 1
  return { timestamp: t, valid: true, features }
}
// Open hand (FIVE / WAVE_GREETING): wrist at the origin, fingertips above it; `sway` moves the
// fingertips sideways relative to the wrist, as tilting the hand back and forth does.
function openHand(t, sway = 0) {
  const f = feature(t)
  const joint = (i, x, y) => { f.features[37 + i * 3] = x; f.features[38 + i * 3] = y }
  for (let j = 0; j < 21; j++) joint(j, 0, 0)
  joint(9, 0, -.2)
  for (const [tip, x] of [[4, -.15], [8, -.08], [12, 0], [16, .08], [20, .15]]) joint(tip, x + sway, -.4)
  return f
}
const frames = make => Array.from({ length: 41 }, (_, i) => make(i * 25))
const scored = (label, top3, accepted = true) => ({ requestId: 'test', label, accepted, score: top3[0].score, top3,
  model: 'test', inferenceMs: 5, frameCount: 40 })

test('motion E: waving separates WAVE_GREETING from a held FIVE, as sideways tilt separates WHAT from ONE', () => {
  const held = frames(t => openHand(t))
  const wave = frames(t => openHand(t, .2 * Math.sin(t / 120)))
  assert.equal(assessSignMotion(wave, 'WAVE_GREETING', 'motion-e').reason, null)
  assert.equal(assessSignMotion(held, 'WAVE_GREETING', 'motion-e').reason, 'awaiting_wave_reversal')
  assert.equal(assessSignMotion(held, 'FIVE', 'motion-e').reason, null)
  assert.equal(assessSignMotion(wave, 'FIVE', 'motion-e').reason, 'motion_conflicts_with_number')
  // A FIVE with waving and some model support for WAVE_GREETING becomes WAVE_GREETING.
  const five = resolveSignByMotion(wave, scored('FIVE', [{ label: 'FIVE', score: .7 }, { label: 'WAVE_GREETING', score: .3 }], false), 'motion-e')
  assert.equal(five.prediction.label, 'WAVE_GREETING')
  assert.equal(five.prediction.accepted, true)
  assert.equal(five.signMotion.resolvedFrom, 'FIVE')
  // Never the other way: a still WAVE_GREETING waits for its motion.
  const still = resolveSignByMotion(held, scored('WAVE_GREETING', [{ label: 'WAVE_GREETING', score: .6 }, { label: 'FIVE', score: .4 }]), 'motion-e')
  assert.equal(still.prediction.label, 'WAVE_GREETING')
  assert.equal(still.signMotion.reason, 'awaiting_wave_reversal')
})

test('motion E: after waving stops, FIVE is accepted once the hold has settled', () => {
  // Waving (back and forth, amplitude .25) until 800 ms, then FIVE held still.
  const sequence = Array.from({ length: 81 }, (_, i) => { const t = i * 25; return openHand(t, t <= 800 ? .25 * Math.sin(t / 100) : 0) })
  const upTo = ms => sequence.filter(f => f.timestamp <= ms)
  // Until the 800 ms settle window no longer reaches back into the waving.
  assert.equal(assessSignMotion(upTo(1100), 'FIVE', 'motion-e').reason, 'motion_conflicts_with_number')
  assert.equal(assessSignMotion(upTo(1800), 'FIVE', 'motion-e').reason, null)
})

test('motion E profile leaves other pairs to the model and v1 unchanged', () => {
  const wave = frames(t => openHand(t, .2 * Math.sin(t / 120)))
  const held = frames(t => openHand(t))
  for (const label of ['ONE', 'WHAT', 'TWO', 'NO', 'SIX', 'WEDNESDAY', 'TEN'])
    assert.equal(assessSignMotion(wave, label, 'motion-e'), null, label)
  assert.equal(assessSignMotion(held, 'WAVE_GREETING'), null, 'v1 has no WAVE_GREETING rule')
  assert.ok(assessSignMotion(held, 'FIVE') !== null, 'v1 still applies its steady-hold rule to FIVE')
  // Sideways onset starts a new sign only for the profile's own pair.
  const a = openHand(0), b = openHand(100, MOTION_E_SETTINGS.palmOnset + .01)
  assert.equal(hasConfusableFingerChange(a, b, 0, 'FIVE', 'motion-e'), true)
  assert.equal(hasConfusableFingerChange(a, b, 0, 'WAVE_GREETING', 'motion-e'), true)
  assert.equal(hasConfusableFingerChange(a, b, 0, 'ONE', 'motion-e'), false)
  assert.equal(hasConfusableFingerChange(a, openHand(100, MOTION_E_SETTINGS.palmOnset - .02), 0, 'FIVE', 'motion-e'), false)
})

// Thumbs-up (TEN) at wrist height y, tilted by `angle` degrees around the wrist.
function thumbsUp(t, angle = 0, y = .5, x = 0) {
  const f = feature(t), r = angle * Math.PI / 180
  const offsets = [[0, 0], [-.05, -.05], [-.08, -.12], [-.09, -.2], [-.09, -.3], [.02, -.15], [.1, -.15], [.1, -.1], [.06, -.08],
    [.03, -.16], [.11, -.16], [.11, -.11], [.07, -.09], [.04, -.15], [.11, -.15], [.11, -.11], [.07, -.09],
    [.05, -.13], [.1, -.13], [.1, -.1], [.07, -.08]]
  offsets.forEach(([dx, dy], j) => {
    f.features[37 + j * 3] = x + dx * Math.cos(r) - dy * Math.sin(r)
    f.features[38 + j * 3] = y + dx * Math.sin(r) + dy * Math.cos(r)
  })
  return f
}

test('motion E: TEN\'s own tilt does not start a new sign; the rise into TOMORROW does, at the rise', () => {
  // TEN held and tilted +-35 degrees from 0 to 1500 ms, confirmed at 600 ms; rise of .6 from 1500 to 1800 ms.
  // (Live landmarks of a +-15 degree tilt already move the joints this much; see the 2026-11-24 trace.)
  const trace = Array.from({ length: 101 }, (_, i) => {
    const t = i * 25
    const rise = t <= 1500 ? 0 : Math.min(.6, (t - 1500) / 300 * .6)
    return thumbsUp(t, t <= 1500 ? 35 * Math.sin(t / 90) : 0, .5 - rise)
  })
  const confirmed = trace.find(f => f.timestamp === 600)
  const upTo = ms => trace.filter(f => f.timestamp <= ms)
  // v1 rules treat the tilt as a new sign almost immediately (the old behaviour).
  const v1Start = findVisibleSignTransition(upTo(1500), confirmed, 'TEN')
  assert.ok(v1Start !== null && v1Start < 1000, `v1 starts during TEN at ${v1Start}`)
  // motion-e waits through the tilt and starts the next sign once the hand has left TEN's height.
  assert.equal(findVisibleSignTransition(upTo(1500), confirmed, 'TEN', 'motion-e'), null)
  const start = findVisibleSignTransition(upTo(2000), confirmed, 'TEN', 'motion-e')
  assert.ok(start !== null && start >= 1500 && start <= 1500 + 300 * TEN_DEPARTURE.holdBand / .6 + 25, `starts at ${start}`)
})

test('motion E: a one-frame tracking glitch in TEN neither triggers nor anchors a transition', () => {
  const trace = Array.from({ length: 61 }, (_, i) => thumbsUp(i * 25, 15 * Math.sin(i * 25 / 90), i === 26 ? .09 : .5))
  const confirmed = trace.find(f => f.timestamp === 650)  // the glitch frame, .41 above the hold
  assert.equal(findVisibleSignTransition(trace, confirmed, 'TEN', 'motion-e'), null)
  const later = trace.find(f => f.timestamp === 900)
  assert.equal(findVisibleSignTransition(trace, later, 'TEN', 'motion-e'), null)
})

// Seeded jitter like a live held hand (whole-hand shift sd ~.01 is too large for a 25 ms grid; .004 here).
function jittered(f, i) {
  const n = k => .004 * Math.sin(i * 12.9898 + k * 78.233)
  for (let j = 0; j < 21; j++) { f.features[37 + j * 3] += n(j); f.features[38 + j * 3] += n(j + 21) }
  return f
}

test('motion E: after WAVE_GREETING the next sign starts once the hand has settled, not during the waving', () => {
  // Waving until 1000 ms (confirmed at 600 ms), then the open hand held still.
  const trace = Array.from({ length: 101 }, (_, i) => {
    const t = i * 25
    return jittered(openHand(t, t < 1000 ? .25 * Math.sin(t / 100) : .25 * Math.sin(10)), i)
  })
  const confirmed = trace.find(f => f.timestamp === 600)
  const upTo = ms => trace.filter(f => f.timestamp <= ms)
  assert.equal(findVisibleSignTransition(upTo(1000), confirmed, 'WAVE_GREETING', 'motion-e'), null, 'waving is not a new sign')
  assert.equal(findVisibleSignTransition(upTo(1000 + WORD_SETTLE.stillMs - 50), confirmed, 'WAVE_GREETING', 'motion-e'), null)
  const start = findVisibleSignTransition(upTo(2000), confirmed, 'WAVE_GREETING', 'motion-e')
  assert.ok(start !== null && start >= 950 && start <= 1100, `starts at ${start}`)
  // A clear departure (the hand moves far away) still starts a new sign.
  const away = Array.from({ length: 61 }, (_, i) => {
    const t = i * 25, f = openHand(t, t < 1000 ? .25 * Math.sin(t / 100) : 0)
    if (t >= 1000) for (let j = 0; j < 21; j++) f.features[37 + j * 3] += Math.min(.6, (t - 1000) / 200 * .6)
    return f
  })
  const departure = findVisibleSignTransition(away, away.find(f => f.timestamp === 600), 'WAVE_GREETING', 'motion-e')
  assert.ok(departure !== null && departure >= 1000 && departure <= 1200, `departure at ${departure}`)
})

test('motion E: right after WAVE_GREETING, a still open hand read as WAVE_GREETING is FIVE', () => {
  const held = frames(t => openHand(t))
  const wave = frames(t => openHand(t, .25 * Math.sin(t / 100)))
  const read = (framesIn, top3) => resolveSignByMotion(framesIn, scored(top3[0].label, top3), 'motion-e')
  const waveRead = [{ label: 'WAVE_GREETING', score: .95 }, { label: 'FIVE', score: .04 }, { label: 'HELLO', score: .01 }]
  const still = resolveStillWordAfterWord(held, read(held, waveRead), 'WAVE_GREETING', 'motion-e')
  assert.equal(still.prediction.label, 'FIVE')
  assert.equal(still.prediction.accepted, true)
  assert.ok(Math.abs(still.prediction.score - .99) < 1e-9)
  assert.equal(still.signMotion.resolvedFrom, 'WAVE_GREETING')
  // Still waving: stays WAVE_GREETING. Not right after WAVE_GREETING, or another profile: unchanged.
  assert.equal(resolveStillWordAfterWord(wave, read(wave, waveRead), 'WAVE_GREETING', 'motion-e').prediction.label, 'WAVE_GREETING')
  assert.equal(resolveStillWordAfterWord(held, read(held, waveRead), 'FIVE', 'motion-e').prediction.label, 'WAVE_GREETING')
  assert.equal(resolveStillWordAfterWord(held, read(held, waveRead), 'WAVE_GREETING', 'v1').prediction.label, 'WAVE_GREETING')
})
