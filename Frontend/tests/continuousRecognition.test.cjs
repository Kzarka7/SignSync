const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')
const { createRecognitionWindows, createActivityPolicy, createObservationTracking, CONTINUOUS_SETTINGS } = load(path.resolve('src/services/landmarks/continuousRecognition.ts'))
const { createDiagnosticSession } = load(path.resolve('src/services/landmarks/recognitionDiagnostics.ts'))
const { assessSignMotion } = load(path.resolve('src/services/landmarks/signMotionEvidence.ts'))

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

test('a completed gesture followed by new motion permits a confirmed repeat with fresh windows', () => {
  const policy = createActivityPolicy()
  policy.update(prediction('Z'), 1500, undefined, 0)
  assert.equal(policy.update(prediction('Z'), 1850, undefined, 350).emit, true)
  for (let t = 2200; t <= 3250; t += 350) {
    assert.equal(policy.update(prediction('Z'), t, undefined, t - 1500).reason, 'duplicate_sign_suppressed')
  }
  policy.observeGestureBoundary(3300, 3500)
  // Overlap with the previous gesture cannot count as a new performance.
  assert.equal(policy.update(prediction('Z'), 3950, undefined, 2450).emit, false)
  assert.equal(policy.update(prediction('Z'), 5000, undefined, 3500).emit, false)
  assert.equal(policy.update(prediction('Z'), 5350, undefined, 3850).emit, true)
  assert.equal(policy.update(prediction('Z'), 5700, undefined, 4200).emit, false)
  assert.ok(policy.events.some(e => e.reason === 'completed_gesture_then_new_motion'))
})

test('old boundaries and interrupted gestures cannot release a held sign', () => {
  for (const interrupt of [false, true]) {
    const policy = createActivityPolicy()
    policy.update(prediction('J'), 1500)
    policy.update(prediction('J'), 1850)
    policy.observeGestureBoundary(interrupt ? 1900 : 1700, interrupt ? 2000 : 1800)
    if (interrupt) policy.discardGestureBoundary()
    for (let t = 2200; t <= 3250; t += 350) assert.equal(policy.update(prediction('J'), t, undefined, 2100).emit, false)
  }
})

test('rolling session prints the same sign twice after two motion episodes but not during the hold', async () => {
  const session = createDiagnosticSession({ source: 'video', name: 'repeat', recognitionMode: 'rolling',
    onChange() {}, now: () => 0, id: () => 'repeat', predict: async () => prediction('Z') })
  for (let t = 0; t <= 7500; t += 50) {
    const f = feature(t)
    const x = t <= 1000 ? t / 1000 : t < 3500 ? 1 : t <= 4500 ? 1 + (t - 3500) / 1000 : 2
    for (let j = 0; j < 21; j++) f.features[37 + j * 3] = x
    await session.observeFeatures(f)
  }
  assert.equal(session.state.transcript.length, 2)
  assert.ok(session.report().acceptanceEvents.some(e => e.reason === 'completed_gesture_then_new_motion'))
})

test('alphabet confidence rejections count as one failed vote while tracking rejection clears evidence', () => {
  for (const reason of ['alphabet_low_confidence', 'alphabet_low_margin', 'alphabet_input_mismatch',
    'stage2_low_confidence', 'stage2_low_margin', 'insufficient_hand_visibility']) {
    const policy = createActivityPolicy({ confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 400 })
    policy.update(prediction('Z'), 0)
    policy.update({ ...prediction('Z', false), rejectionReason: reason }, 200)
    policy.update(prediction('Z'), 400)
    const result = policy.update(prediction('Z'), 600)
    assert.equal(result.emit, reason !== 'insufficient_hand_visibility', reason)
  }
})

test('43-sign Lab sessions suppress predictions from one unbroken motion and permit a fresh segment', async () => {
  for (const modelMode of ['lab-signs43-numbers', 'lab-signs43-shape-motion', 'lab-signs43-similarity']) {
    const session = createDiagnosticSession({ source: 'video', name: 'changing prediction', modelMode,
      recognitionMode: 'segmented', segmentAcceptance: 'confirmation',
      settings: { strideMs: 150, confirmationWindows: 2, confirmationHistory: 3, confirmationMs: 150 },
      onChange() {}, now: () => 0, id: () => 'lab-confirmation',
      predict: async ({ frames }) => {
        const end = frames.at(-1).timestamp
        return prediction(end >= 1050 && end < 1900 ? 'WHAT' : 'ONE')
      } })
    for (let t = 0; t <= 3400; t += 50) {
      const frame = feature(t)
      const firstMotion = Math.min(t, 1650)
      const secondMotion = Math.max(0, Math.min(t - 2250, 900))
      for (let j = 0; j < 21; j++) frame.features[37 + j * 3] = (firstMotion + secondMotion) / 1000
      await session.observeFeatures(frame)
    }
    const { rows, transcript } = session.state
    assert.deepEqual(Array.from(transcript, entry => entry.label), ['ONE', 'ONE'])
    assert.ok(rows.some(row => row.reason === 'waiting_for_new_sign' && !row.emit))
    assert.equal(new Set(rows.filter(row => row.emit).map(row => row.segmentId)).size, 2)
  }
})

for (const [modelMode, initialLabel, movingLabel, holdLabel] of [
  ['lab-signs43-similarity', 'ONE', 'WHAT', 'SIX'],
  ['lab-alphabet', 'I', 'J', 'X'],
]) test(`${modelMode} can confirm the next sign while the hand stays visible`, async () => {
  for (const source of ['video','camera']) for (const transition of ['motion after a hold','handshape during motion','handshape to hold']) {
    const session = createDiagnosticSession({source,name:transition,modelMode,
      recognitionMode:'segmented',segmentAcceptance:'confirmation',
      settings:{strideMs:150,confirmationWindows:3,confirmationHistory:4,confirmationMs:400},
      onChange(){},now:()=>0,id:()=>transition,predict:async ({frames})=>{
        const first=frames[0], last=frames.at(-1)
        const isNext=transition === 'motion after a hold' ? last.features[37]-first.features[37] >= .15
          : last.features[41]-last.features[38] >= .10
        return prediction(isNext ? (transition === 'motion after a hold' ? movingLabel : holdLabel) : initialLabel)
      } })
    for(let t=0;t<=2375;t+=25){
      const f=feature(t)
      const progress=Math.max(0,Math.min(1,(t-1050)/200))
      const entry=.12*Math.min(1,t/150)
      const x=transition === 'handshape during motion' ? t/1300 : entry+(transition === 'motion after a hold' ? .48*progress : 0)
      for(let j=0;j<21;j++){
        f.features[37+j*3]=x
        if(j>0 && transition !== 'motion after a hold') f.features[38+j*3]=.16*progress
      }
      await session.observeFeatures(f)
      if(source==='camera') await new Promise(resolve=>setImmediate(resolve))
    }
    const {rows,transcript}=session.state
    assert.deepEqual(Array.from(transcript,e=>e.label),[initialLabel,transition==='motion after a hold'?movingLabel:holdLabel],`${source} ${transition}`)
    const [first,second]=rows.filter(r=>r.emit)
    assert.equal(second.segmentId,first.segmentId,transition)
    assert.ok(second.startMs>=first.endMs,transition)
  }
})

test('43-sign confirmation does not accept a motion-required label from a steady hold',async()=>{
  const session=createDiagnosticSession({source:'video',name:'steady',modelMode:'lab-signs43-similarity',
    recognitionMode:'segmented',segmentAcceptance:'confirmation',settings:{strideMs:150},
    onChange(){},now:()=>0,id:()=> 'steady',predict:async()=>prediction('WHAT')})
  for(let t=0;t<=1550;t+=25){
    const f=feature(t)
    for(let j=0;j<21;j++) f.features[37+j*3]=t<150 ? .016*(-1)**(t/25) : 0
    await session.observeFeatures(f)
  }
  assert.equal(session.state.transcript.length,0)
  assert.ok(session.state.rows.some(row=>row.reason==='sign_requires_motion'))
})

test('Lab minimum confidence and confirmation time independently control transcript acceptance',async()=>{
  for(const [minimumConfidence,confirmationMs,expectedMs] of [[.75,400,850],[.75,650,1150],[.80,650,null]]) {
    const session=createDiagnosticSession({source:'video',name:'tuned confirmation',modelMode:'lab-signs43-similarity',
      recognitionMode:'segmented',segmentAcceptance:'confirmation',minimumConfidence,
      settings:{strideMs:150,confirmationWindows:3,confirmationHistory:7,confirmationMs},
      onChange(){},now:()=>0,id:()=> 'tuned',predict:async()=>({...prediction('SIX'),score:.78})})
    for(let t=0;t<=1600;t+=25){
      const f=feature(t)
      for(let j=0;j<21;j++) f.features[37+j*3]=Math.min(t,300)/1000
      await session.observeFeatures(f)
    }
    const report=session.report()
    assert.equal(report.transcript[0]?.decisionMs ?? null,expectedMs)
    assert.equal(report.minimumConfidence,minimumConfidence)
    assert.equal(report.settings.confirmationMs,confirmationMs)
    if(expectedMs===null) assert.ok(report.rows.some(row=>row.reason==='below_minimum_confidence' && row.prediction.accepted))
  }
})

function signFeature(t, {shift=0,index=0,gap=1.3}={}) {
  const f=feature(t)
  const joint=(i,x,y)=>{f.features[37+i*3]=x+shift;f.features[38+i*3]=y}
  for(let j=0;j<21;j++) joint(j,0,0)
  joint(9,0,.2); joint(4,0,.4)
  joint(8,index,.4-.2*gap); joint(12,0,.4-.2*gap)
  return f
}

test('sideways reversals and finger opening/closing separate the moving labels from held numbers',()=>{
  const frames=make=>Array.from({length:41},(_,i)=>make(i*25))
  const held=frames(t=>signFeature(t,{shift:t*.00006}))
  const slide=frames(t=>signFeature(t,{shift:t*.00030}))
  const what=frames(t=>signFeature(t,{index:.24*Math.sin(t/130)}))
  const no=frames(t=>signFeature(t,{gap:.9+.65*Math.sin(t/100)}))
  assert.equal(assessSignMotion(held,'ONE').reason,null)
  assert.equal(assessSignMotion(slide,'WHAT').reason,'awaiting_sideways_reversal')
  assert.equal(assessSignMotion(what,'WHAT').reason,null)
  assert.equal(assessSignMotion(what,'ONE').reason,'motion_conflicts_with_number')
  for(const label of ['TWO','THREE']) {
    assert.equal(assessSignMotion(held,label).reason,null)
    assert.equal(assessSignMotion(no,label).reason,'motion_conflicts_with_number')
  }
  assert.equal(assessSignMotion(held,'NO').reason,'awaiting_finger_reversal')
  assert.equal(assessSignMotion(no,'NO').reason,null)
  assert.equal(assessSignMotion(no.filter((_,i)=>i%20===0),'NO').reason,'motion_tracking_incomplete')
  const sparseTurn=[0,0,.24,0,0].map((index,i)=>signFeature(i*100,{index}))
  const settledTail=Array.from({length:16},(_,i)=>signFeature(425+i*25))
  assert.equal(assessSignMotion([...sparseTurn,...settledTail],'WHAT').reason,null)
})

test('finger motion can start a fresh NO after TWO or THREE with a stationary wrist',async()=>{
  for(const label of ['TWO','THREE']) {
    const session=createDiagnosticSession({source:'video',name:'finger transition',modelMode:'lab-signs43-similarity',
      recognitionMode:'segmented',segmentAcceptance:'confirmation',staticMotionCheck:true,minimumConfidence:.75,
      settings:{strideMs:150,confirmationWindows:5,confirmationHistory:7,confirmationMs:650},
      onChange(){},now:()=>0,id:()=> 'finger-transition',predict:async ({frames})=>prediction(frames.at(-1).timestamp>1250?'NO':label)})
    for(let t=0;t<=3100;t+=25){
      const shift=.12*Math.min(1,t/150)
      const gap=t<1200?1.3:.8+.5*Math.cos((t-1200)/100)
      await session.observeFeatures(signFeature(t,{shift,gap}))
    }
    const accepted=session.state.rows.filter(row=>row.emit)
    assert.deepEqual(Array.from(accepted,row=>row.prediction.label),[label,'NO'])
    assert.equal(accepted[0].segmentId,accepted[1].segmentId)
    assert.equal(accepted[1].signMotion.cue,'thumb_finger_turn')
  }
})

test('Stage 2 fast confirmation requires two strong handshape votes', () => {
  for (const [label, inputKind, strong, expected] of [
    ['FIVE', 'static', true, true], ['FIVE', 'static', false, false],
    ['J', 'joint', true, false], ['Z', 'joint', true, false], ['TEN', 'joint', true, false],
  ]) {
    const policy = createActivityPolicy({ confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 400 }, true)
    const result = { ...prediction(label), inputKind }
    policy.update({ ...result, score: strong ? .99 : .85 }, 0)
    assert.equal(policy.update(result, 150).emit, expected, label)
  }
})

test('Stage 2 replay can confirm a handshape while the hand is moving', async () => {
  const session = createDiagnosticSession({ source: 'video', name: 'Stage 2 replay', modelMode: 'lab-stage2',
    settings: { strideMs: 150, confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 400 },
    onChange() {}, now: () => 0, id: () => 'stage2-replay',
    predict: async () => ({ ...prediction('E'), inputKind: 'static', inputReason: 'recent_handshape_only' }),
  })
  for (let t = 0; t <= 1650; t += 50) {
    const frame = feature(t)
    for (let j = 0; j < 21; j++) frame.features[37 + j * 3] = t / 1000
    await session.observeFeatures(frame)
  }
  const { rows, transcript } = session.state
  assert.deepEqual(Array.from(rows, row => row.emit), [false, true])
  assert.deepEqual(Array.from(transcript, entry => entry.label), ['E'])
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
