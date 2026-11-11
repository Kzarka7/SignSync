const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const load=require('../scripts/loadTypeScript.cjs')
const {createGestureSegmentation}=load(path.resolve('src/services/landmarks/gestureSegmentation.ts'))
const {createDiagnosticSession}=load(path.resolve('src/services/landmarks/recognitionDiagnostics.ts'))
const {LIVE_RECOGNITION_POLICY}=load(path.resolve('src/services/landmarks/liveRecognitionPolicy.ts'))
function frame(t,y=0,hands=true,valid=true){
  const features=Array(164).fill(0);features[7]=features[11]=1;features[36]=hands?1:0
  features[21]=y;features[23]=1;features[25]=y;features[27]=1
  for(let j=0;j<21;j++){features[37+j*3]=.4+j*.001;features[38+j*3]=y}
  return {timestamp:t,features,valid}
}
function motion(t){return frame(t,t<350?0:t<=700? .4-(t-350)/350:t<=1000?-.6+(t-700)/300*1.7:1.5,t>=350&&t<=1000)}
const prediction=request=>({requestId:request.requestId,label:'HELLO',score:.99,accepted:true,top3:[{label:'HELLO',score:.99},{label:'YES',score:.01}],model:'test',inferenceMs:1,frameCount:request.frames.length})
test('observed withdrawal completes a short gesture; source end never flushes an unfinished gesture',()=>{
  const detector=createGestureSegmentation(),packets=[],events=[]
  for(let t=0;t<=1400;t+=50){const r=detector.push(motion(t));if(r.window)packets.push(r.window);events.push(...r.events)}
  assert.equal(packets.filter(w=>w.complete).length,1)
  assert.ok(events.some(e=>e.type==='complete'&&e.reason==='observed_withdrawal'))
  const unfinished=createGestureSegmentation()
  for(let t=0;t<=650;t+=50)unfinished.push(motion(t))
  assert.equal(unfinished.finish(650)[0].reason,'source_ended_before_completion')
})
test('Stage 2 separates successive handshape changes with a stationary wrist', () => {
  const detector = createGestureSegmentation(150, true)
  const completions = []
  for (let t = 0; t <= 1700; t += 25) {
    const f = frame(t)
    const amount = Math.max(0, Math.min(1, (t - 300) / 200)) -
      Math.max(0, Math.min(1, (t - 1000) / 200))
    for (let j = 1; j < 21; j++) f.features[38 + j * 3] = amount * .18
    const { window } = detector.push(f)
    if (window?.complete) completions.push(window)
  }
  assert.equal(completions.length, 2)
  assert.notEqual(completions[0].segmentId, completions[1].segmentId)
  assert.equal(completions[0].frames.at(-1).features[41], .18)
  assert.equal(completions[1].frames.at(-1).features[41], 0)
})
test('pose loss, high hand disappearance and frame gaps cannot complete a gesture',()=>{
  for(const cause of ['pose','hand','gap']){
    const d=createGestureSegmentation(),events=[]
    for(let t=0;t<=700;t+=50)events.push(...d.push(motion(t)).events)
    if(cause==='gap')events.push(...d.push(frame(1200,-.6)).events)
    else for(let t=750;t<=1100;t+=50)events.push(...d.push(frame(t,-.6,cause!=='hand',cause!=='pose')).events)
    assert.ok(events.some(e=>e.type==='discard'),cause)
    assert.ok(!events.some(e=>e.type==='complete'),cause)
  }
})
test('stationary visible hands and small jitter cannot create repeated gestures',()=>{
  const d=createGestureSegmentation(),events=[]
  for(let t=0;t<=4000;t+=50)events.push(...d.push(frame(t,Math.sin(t)*.002)).events)
  assert.equal(events.length,0)
})
test('an inactive resting hand dropping out does not discard the signing hand',()=>{
  const d=createGestureSegmentation(),events=[]
  for(let t=0;t<=1400;t+=50){
    const f=motion(t)
    f.features[100]=t<700?1:0
    for(let j=0;j<21;j++){f.features[101+j*3]=-.5;f.features[102+j*3]=1.5}
    events.push(...d.push(f).events)
  }
  assert.ok(events.some(e=>e.type==='complete'))
  assert.ok(!events.some(e=>e.reason==='unverified_hand_loss'))
})
test('a pose wrist moving down cannot substitute for an unobserved hand withdrawal',()=>{
  const d=createGestureSegmentation(),events=[]
  for(let t=0;t<=700;t+=50)events.push(...d.push(motion(t)).events)
  for(let t=750;t<=1100;t+=50){const f=frame(t,-.6,false);f.features[21]=2;events.push(...d.push(f).events)}
  assert.ok(events.some(e=>e.type==='discard'))
  assert.ok(!events.some(e=>e.type==='complete'))
})
test('segmented transcript waits for completion and preserves model rejection',async()=>{
  for(const accepted of [true,false]){
    const s=createDiagnosticSession({source:'video',name:'gesture',recognitionMode:'segmented',
      settings:{strideMs:150,confirmationWindows:3,confirmationHistory:4,confirmationMs:400},
      predict:async r=>({...prediction(r),accepted}),onChange(){},now:()=>0,id:()=>String(Math.random())})
    for(let t=0;t<=1000;t+=50)await s.observeFeatures(motion(t))
    assert.equal(s.state.transcript.length,0)
    for(let t=1050;t<=1400;t+=50)await s.observeFeatures(motion(t))
    await s.finish()
    assert.equal(s.state.transcript.length,accepted?1:0)
    assert.ok(s.report().segmentationEvents.some(e=>e.type==='complete'))
    if(accepted)assert.equal(s.report().rows.filter(r=>r.emit)[0].reason,'gesture_completed_confirmed')
  }
})
test('stopping during camera inference prevents segmented entries and clears pending work',async()=>{
  let resolve
  const s=createDiagnosticSession({source:'camera',name:'stop',recognitionMode:'segmented',
    predict:r=>new Promise(done=>{resolve=()=>done(prediction(r))}),onChange(){},now:()=>0,id:()=>String(Math.random())})
  for(let t=0;t<=1400;t+=50)await s.observeFeatures(motion(t))
  s.stop();resolve();await new Promise(done=>setImmediate(done))
  assert.equal(s.state.transcript.length,0)
  assert.equal(s.state.rows.length,0)
  assert.equal(s.state.failure,null)
})
test('low-FPS segments never send fewer than eight frames to the backend',async()=>{
  const s=createDiagnosticSession({source:'video',name:'low fps',recognitionMode:'segmented',
    predict:async r=>{assert.ok(r.frames.length>=8);return prediction(r)},onChange(){},now:()=>0,id:()=>String(Math.random())})
  for(let t=0;t<=1400;t+=200)await s.observeFeatures(motion(t))
  await s.finish()
  assert.equal(s.state.failure,null)
  assert.equal(s.state.transcript.length,0)
})

test('confirmation mode emits before completion and preserves the entry through score drops and tracking loss',async()=>{
  const s=createDiagnosticSession({source:'video',name:'early confirmation',recognitionMode:'segmented',segmentAcceptance:'confirmation',
    settings:{strideMs:150,confirmationWindows:3,confirmationHistory:4,confirmationMs:400},
    predict:async r=>({...prediction(r),accepted:r.frames.at(-1).timestamp<1800,score:r.frames.at(-1).timestamp<1800?.99:.32}),
    onChange(){},now:()=>0,id:()=>String(Math.random())})
  for(let t=0;t<=1750;t+=50)await s.observeFeatures(frame(t,Math.sin(t/200)*.5))
  assert.equal(s.state.transcript.length,1)
  assert.equal(s.report().segmentationEvents.filter(e=>e.type==='complete').length,0)
  const entry={...s.state.transcript[0]}
  assert.equal(s.report().rows.find(r=>r.emit).reason,'gesture_accepted_on_confirmation')
  for(let t=1800;t<=2200;t+=50)await s.observeFeatures(frame(t,Math.sin(t/200)*.5))
  for(let t=2250;t<=2600;t+=50)await s.observeFeatures(frame(t,-.5,false))
  await s.finish()
  assert.deepEqual(JSON.parse(JSON.stringify(s.state.transcript)),[entry])
  assert.equal(s.report().segmentAcceptance,'confirmation')
})

test('confirmation mode never accepts rejected model predictions',async()=>{
  const s=createDiagnosticSession({source:'video',name:'rejected',recognitionMode:'segmented',segmentAcceptance:'confirmation',
    predict:async r=>({...prediction(r),accepted:false}),onChange(){},now:()=>0,id:()=>String(Math.random())})
  for(let t=0;t<=2600;t+=50)await s.observeFeatures(frame(t,Math.sin(t/200)*.5))
  await s.finish()
  assert.equal(s.state.transcript.length,0)
})

test('a tuned alphabet hold stays open long enough for slower confirmation', async () => {
  let requestId = 0
  const session = createDiagnosticSession({
    source: 'video', name: 'slow alphabet confirmation', modelMode: 'lab-alphabet',
    ...LIVE_RECOGNITION_POLICY, waitForConfirmation: true,
    settings: { strideMs: 150, confirmationWindows: 8, confirmationHistory: 10, confirmationMs: 1200 },
    predict: async request => prediction(request), onChange() {}, now: () => 0, id: () => String(++requestId),
  })
  for (let time = 0; time <= 2200; time += 50) {
    await session.observeFeatures(frame(time, Math.min(time / 600, 1)))
  }
  const report = session.report()
  const firstVote = report.rows.find(row => row.prediction)
  const accepted = report.rows.find(row => row.emit)
  const completed = report.segmentationEvents.find(event => event.type === 'complete')
  assert.equal(session.state.transcript.length, 1)
  assert.ok(accepted.decisionMs - firstVote.decisionMs >= 1200)
  assert.ok(completed.timestampMs > accepted.decisionMs)
})

test('completed gesture and fresh visible-hand motion allow a repeated sign; holding still does not',async()=>{
  for(const modelMode of ['lab-grouped','lab-clip','lab-alphabet']) for(const source of ['video','camera']) {
    const s=createDiagnosticSession({source,name:'repeat',modelMode,...LIVE_RECOGNITION_POLICY,
      numberHoldExperiment:modelMode!=='lab-alphabet',
      predict:async r=>prediction(r),onChange(){},now:()=>0,id:()=>String(Math.random())})
    const observe=async f=>{await s.observeFeatures(f);await new Promise(done=>setImmediate(done))}
    for(let t=0;t<=2500;t+=50)await observe(frame(t,t<=1000?t/1000:1))
    assert.equal(s.state.transcript.length,1,source)
    assert.ok(s.report().segmentationEvents.some(e=>e.type==='complete'))
    for(let t=2550;t<=4500;t+=50)await observe(frame(t,t<=3500?1-(t-2500)/1000:0))
    assert.equal(s.state.transcript.length,2,source)
    assert.equal(s.report().summary.rearmedByGesture,1)
    const rows=s.report().rows.filter(r=>r.emit)
    assert.notEqual(rows[0].segmentId,rows[1].segmentId)
    const boundary=s.report().segmentationEvents.find(e=>e.type==='complete')
    assert.ok(rows[1].startMs>boundary.timestampMs)
    s.stop()
  }
})

test('new segments after interruptions require fresh confirmation before repeating',async()=>{
  for(const interruption of ['timeout','hands','pose','gap']) {
    const s=createDiagnosticSession({source:'video',name:interruption,recognitionMode:'segmented',segmentAcceptance:'confirmation',
      predict:async r=>prediction(r),onChange(){},now:()=>0,id:()=>String(Math.random())})
    for(let t=0;t<=1800;t+=50)await s.observeFeatures(frame(t,Math.sin(t/200)*.5))
    assert.equal(s.state.transcript.length,1)
    for(let t=1850;t<=6500;t+=50){
      if(interruption==='gap' && t<2300)continue
      const lost=t<=2150
      await s.observeFeatures(frame(t,Math.sin(t/200)*.5,!(interruption==='hands'&&lost),!(interruption==='pose'&&lost)))
    }
    assert.ok(s.state.transcript.length>1,interruption)
    const report=s.report()
    for(const row of report.rows.filter(r=>r.emit).slice(1)) {
      assert.ok(report.rows.some(r=>r.segmentId===row.segmentId && r.reason==='confirming' && r.endMs<row.endMs),interruption)
    }
    assert.equal(s.report().summary.rearmedByGesture,0)
    s.stop()
  }
})

test('alphabet repeats use fresh segment confirmation with finger motion and a stationary wrist',async()=>{
  for (const source of ['video','camera']) {
    const s=createDiagnosticSession({source,name:'small alphabet motion',modelMode:'lab-alphabet',
      ...LIVE_RECOGNITION_POLICY,
      settings:{strideMs:150,confirmationWindows:3,confirmationHistory:4,confirmationMs:400},
      predict:async r=>({...prediction(r),label:'A',top3:[{label:'A',score:.99}]}),
      onChange(){},now:()=>0,id:()=>String(Math.random())})
    const observe=async f=>{await s.observeFeatures(f);await new Promise(done=>setImmediate(done))}
    const small=(t,onset)=>{
      const f=frame(t)
      // The wrist does not travel. Brief finger movement starts a segment,
      // then the user holds the static handshape for confirmation.
      const flex=Math.min(.12,Math.max(0,t-onset)*.0008)
      for(let j=1;j<21;j++)f.features[38+j*3]+=flex
      return f
    }
    for(let t=0;t<=1800;t+=50)await observe(small(t,0))
    assert.equal(s.state.transcript.length,1,source)
    for(let t=1850;t<=2250;t+=50)await observe(frame(t,0,false))
    for(let t=2300;t<=4100;t+=50)await observe(small(t,2300))
    assert.equal(s.state.transcript.length,2,source)
    const report=s.report(),accepted=report.rows.filter(r=>r.emit)
    const completed = report.segmentationEvents.filter(event => event.type === 'complete')
    assert.deepEqual(Array.from(completed, event => event.segmentId), Array.from(accepted, row => row.segmentId))
    assert.notEqual(accepted[0].segmentId,accepted[1].segmentId)
    assert.ok(accepted.every(r=>r.reason==='gesture_accepted_on_confirmation'))
    s.stop()
  }
})

test('live fingerspelling repeats a low-travel letter after it settles and fresh motion starts', async () => {
  for (const repeatAt of [850, 1400]) {
    let requestId = 0
    const session = createDiagnosticSession({
      source: 'camera', name: 'repeat letter', modelMode: 'lab-alphabet',
      ...LIVE_RECOGNITION_POLICY, settleConfirmedHold: true,
      settings: { strideMs: 150, confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 300 },
      predict: async request => ({ ...prediction(request), label: 'L', top3: [{ label: 'L', score: .99 }] }),
      onChange() {}, now: () => 0, id: () => String(++requestId),
    })
    for (let time = 0; time <= 3000; time += 25) {
      const first = Math.min(time / 150, 1)
      const repeat = Math.max(0, Math.min((time - repeatAt) / 150, 1))
      await session.observeFeatures(frame(time, -.12 * (first - repeat)))
      await new Promise(resolve => setImmediate(resolve))
    }
    const accepted = session.report().rows.filter(row => row.emit)
    assert.equal(accepted.length, repeatAt === 1400 ? 2 : 1)
    assert.equal(new Set(accepted.map(row => row.segmentId)).size, accepted.length)
    assert.ok(accepted.every(row => row.prediction.label === 'L'))
    session.stop()
  }
})

test('alphabet can resume after the segment limit with a handshape change alone', async () => {
  let requestId = 0
  const session = createDiagnosticSession({
    source: 'video', name: 'alphabet long hold', modelMode: 'lab-alphabet',
    ...LIVE_RECOGNITION_POLICY,
    settings: { strideMs: 150, confirmationWindows: 3, confirmationHistory: 4, confirmationMs: 400 },
    predict: async request => {
      const last = request.frames.at(-1)
      return { ...prediction(request), label: last.features[41] - last.features[38] > .05 ? 'X' : 'I' }
    },
    onChange() {}, now: () => 0, id: () => String(++requestId),
  })
  for (let time = 0; time <= 6300; time += 25) {
    const sample = frame(time, -.12 * Math.min(time / 150, 1))
    const flex = .09 * Math.max(0, Math.min(1, (time - 5000) / 200))
    for (let joint = 1; joint < 21; joint++) sample.features[38 + joint * 3] += flex
    await session.observeFeatures(sample)
  }
  assert.deepEqual(Array.from(session.state.transcript, entry => entry.label), ['I', 'X'])
  const report = session.report()
  assert.ok(report.segmentationEvents.some(event => event.reason === 'gesture_duration_limit'))
  const [first, next] = report.rows.filter(row => row.emit)
  assert.notEqual(next.segmentId, first.segmentId)
  assert.ok(next.startMs >= 4800)
})

test('fingerspelling finishes a word once after 1200 ms of valid hands-free frames', async () => {
  for (const source of ['camera', 'video']) {
    const boundaries = []
    const session = createDiagnosticSession({
      source, name: 'word pause', modelMode: 'lab-alphabet', ...LIVE_RECOGNITION_POLICY,
      predict: async request => prediction(request), id: () => 'pause', onChange() {},
      onWordBoundary: () => boundaries.push(session.state.latestMs),
    })
    for (let time = 0; time <= 3700; time += 100) {
      if (time > 2400 && time < 2800) continue
      await session.observeFeatures(frame(time, 0, time === 900, time !== 1900))
    }
    assert.deepEqual(boundaries, [])
    await session.observeFeatures(frame(3800, 0, false))
    assert.deepEqual(boundaries, [])
    await session.observeFeatures(frame(4100, 0, false))
    await session.observeFeatures(frame(4200, 0, false))
    assert.deepEqual(boundaries, [4100])
  }
})

test('a fingerspelling boundary waits for pending camera inference', async () => {
  const boundaries = []
  let resolvePrediction
  const session = createDiagnosticSession({
    source: 'camera', name: 'pending letter', modelMode: 'lab-alphabet', ...LIVE_RECOGNITION_POLICY,
    predict: request => new Promise(resolve => { resolvePrediction = () => resolve(prediction(request)) }),
    id: () => 'pending', now: () => 0, onChange() {},
    onWordBoundary: () => boundaries.push(session.state.rows.length),
  })
  for (let time = 0; time <= 1900; time += 50) {
    await session.observeFeatures(frame(time, -time / 1000, time <= 650))
  }
  assert.ok(resolvePrediction)
  assert.deepEqual(boundaries, [])
  while (session.state.busy) {
    resolvePrediction()
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.deepEqual(boundaries, [session.state.rows.length])
})

function previewFrame(t, { y = .1, x = 0, hands = true } = {}) {
  const f = frame(t,y,hands)
  for (let j=0; j<21; j++) f.features[37+j*3] += x
  return f
}

function previewSession(predictLabel, source='video', shortPreview=true) {
  let id = 0
  return createDiagnosticSession({ source, name:'hold and motion', modelMode:'lab-signs43-shape-motion',
    recognitionMode:'segmented', segmentAcceptance:'preview', shortPreview, onChange(){}, now:()=>0, id:()=>String(++id),
    predict:async request=>{
      const span = request.frames.at(-1).timestamp-request.frames[0].timestamp
      assert.ok(span >= (request.preview ? 350 : 400))
      const label = predictLabel(request.frames)
      return { ...prediction(request), label, top3:[{label,score:.99}] }
    } })
}

test('the faster Lab preview starts at 350 ms and the compatible path starts at 400 ms',async()=>{
  for (const shortPreview of [true,false]) {
    const s = previewSession(()=> 'ONE','video',shortPreview)
    for (let t=0; t<=400; t+=25) await s.observeFeatures(previewFrame(t))
    assert.equal(s.state.rows[0].decisionMs,shortPreview ? 350 : 400)
    assert.equal(s.state.rows[0].activity,'PREVIEW · ONE')
    assert.equal(s.state.rows[0].earlyPreview === true,shortPreview)
    assert.equal(s.state.rows.at(-1).decisionMs,400)
    assert.equal(s.state.transcript.length,0)
  }
})

test('the short preview alone does not support a transcript entry',async()=>{
  let id = 0, fullWindows = 0
  const s = createDiagnosticSession({ source:'video', name:'preview evidence', modelMode:'lab-signs43-shape-motion',
    recognitionMode:'segmented', segmentAcceptance:'preview', shortPreview:true, onChange(){}, now:()=>0, id:()=>String(++id),
    predict:async request=>({ ...prediction(request), label:'ONE', top3:[{label:'ONE',score:.99}],
      accepted:request.preview || ++fullWindows > 1 }) })
  for (let t=0; t<=800; t+=25) {
    const y = t<=400 ? .1 : Math.min(.85,.1+(t-400)*.002)
    await s.observeFeatures(previewFrame(t,{y}))
  }
  assert.ok(s.state.rows.some(row=>row.earlyPreview && row.activity==='PREVIEW · ONE'))
  assert.ok(s.state.rows.some(row=>row.complete && row.prediction.accepted))
  assert.equal(s.state.transcript.length,0)
})

test('a preview can display a label while its transcript entry still needs the selected confidence and time',async()=>{
  for(const [score,confirmationMs,expected] of [[.78,650,true],[.74,650,false],[.78,1200,false]]) {
    const s=createDiagnosticSession({source:'video',name:'tuned preview',modelMode:'lab-signs43-similarity',
      recognitionMode:'segmented',segmentAcceptance:'preview',shortPreview:true,adaptivePreview:true,minimumConfidence:.75,
      settings:{strideMs:150,confirmationWindows:3,confirmationHistory:10,confirmationMs},
      onChange(){},now:()=>0,id:()=> 'tuned-preview',predict:async request=>({...prediction(request),score,label:'ONE',top3:[{label:'ONE',score}]})})
    for(let t=0;t<=1650;t+=25){
      const y=t<=1125?.1:Math.min(.8,.1+(t-1125)*.002)
      await s.observeFeatures(previewFrame(t,{y}))
    }
    assert.ok(s.state.rows.some(row=>row.earlyPreview && row.activity==='PREVIEW · ONE'))
    assert.equal(s.state.transcript.length,expected?1:0)
    const completed=s.state.rows.find(row=>row.complete)
    assert.equal(completed.reason,expected?'gesture_completed_confirmed':score<.75?'below_minimum_confidence':'completion_needs_more_evidence')
  }
})

test('ONE previews during a hold and confirms once using frames from before lowering',async()=>{
  for (const source of ['video','camera']) {
    const s = previewSession(frames=>frames.some(f=>f.features[38]>.25)?'WHAT':'ONE',source)
    for (let t=0; t<=1800; t+=25) {
      const y=t<=1200 ? .1+.012*Math.sin(t/200) : Math.min(.85,.1+(t-1200)*.002)
      await s.observeFeatures(previewFrame(t,{y}))
      if (source==='camera') await new Promise(done=>setImmediate(done))
      if (t===1000) {
        assert.equal(s.state.rows.at(-1).activity,'PREVIEW · ONE')
        assert.equal(s.state.transcript.length,0)
      }
    }
    await s.finish()
    assert.deepEqual(Array.from(s.state.transcript,entry=>entry.label),['ONE'])
    assert.equal(s.state.transcript[0].decisionMs,1450)
    assert.ok(s.report().segmentationEvents.some(e=>e.reason==='held_pose_released'))
  }
})

test('a held preview can change to WHAT or TEN before the same segment confirms',async()=>{
  for (const moving of ['WHAT','TEN']) {
    const s = previewSession(frames=>frames.some(f=>f.features[37]>.6)?moving:'ONE')
    for (let t=0; t<=2350; t+=25) {
      const x=t>1000 && t<1700 ? .36*Math.sin(Math.PI*(t-1000)/700) : 0
      await s.observeFeatures(previewFrame(t,{x}))
      if (t===950) assert.equal(s.state.rows.at(-1).activity,'PREVIEW · ONE')
      if (t<2000) assert.equal(s.state.transcript.length,0)
    }
    assert.ok(s.state.rows.some(r=>r.activity===`PREVIEW · ${moving}`))
    assert.deepEqual(Array.from(s.state.transcript,entry=>entry.label),[moving])
    assert.equal(new Set(s.state.rows.map(r=>r.segmentId)).size,1)
    assert.equal(s.state.transcript[0].decisionMs,2025)
  }
})

test('a brief tracking loss discards a hold instead of confirming it',async()=>{
  const s = previewSession(()=> 'ONE')
  for (let t=0; t<=1300; t+=25) await s.observeFeatures(previewFrame(t,{hands:t<=1000}))
  await s.finish()
  assert.ok(s.state.rows.some(r=>r.activity==='PREVIEW · ONE'))
  assert.equal(s.state.transcript.length,0)
  assert.ok(s.report().segmentationEvents.some(e=>e.reason==='unverified_hand_loss'))
})

test('a stationary pose cannot confirm a motion-required label even at high confidence',async()=>{
  const s = previewSession(()=> 'WHAT')
  for (let t=0; t<=1800; t+=25) {
    const y=t<=1200 ? .1 : Math.min(.85,.1+(t-1200)*.002)
    await s.observeFeatures(previewFrame(t,{y}))
  }
  assert.equal(s.state.transcript.length,0)
  assert.ok(s.state.rows.some(r=>r.complete && r.reason==='sign_requires_motion'))
})

test('a single wrist tracking jump cannot confirm a stationary pose',async()=>{
  const s = previewSession(()=> 'ONE')
  for (let t=0; t<=1500; t+=25) await s.observeFeatures(previewFrame(t,{y:t<1000?.1:.8}))
  await s.finish()
  assert.equal(s.state.transcript.length,0)
  assert.ok(s.report().segmentationEvents.every(e=>e.reason!=='held_pose_released'))
})

test('separate hold and motion gestures can confirm consecutively without duplicates',async()=>{
  const s = previewSession(frames=>frames.some(f=>f.features[37]>.6)?'WHAT':'ONE')
  for (let t=0; t<=3500; t+=25) {
    const hands = t<=1400 || t>=1700
    const y=t<1000 || t>=1700 ? .1 : Math.min(.85,.1+(t-1000)*.002)
    const x=t>1800 && t<2700 ? .36*Math.sin(Math.PI*(t-1800)/900) : 0
    await s.observeFeatures(previewFrame(t,{y,x,hands}))
  }
  await s.finish()
  assert.deepEqual(Array.from(s.state.transcript,entry=>entry.label),['ONE','WHAT'])
  assert.equal(new Set(s.state.rows.filter(row=>row.emit).map(row=>row.segmentId)).size,2)
})

function adaptiveSession(predict, adaptivePreview=true) {
  let id = 0
  return createDiagnosticSession({ source:'video', name:'adaptive confirmation', modelMode:'lab-signs43-similarity',
    recognitionMode:'segmented', segmentAcceptance:'preview', adaptivePreview, settings:{strideMs:150},
    onChange(){}, now:()=>0, id:()=>String(++id), predict:async request=>{
      const result = predict(request.frames.at(-1).timestamp)
      return { ...prediction(request), ...result, top3:[{label:result.label,score:result.score},{label:'YES',score:.12}] }
    } })
}

async function replayMotion(s, jitter=false) {
  for (let t=0; t<=1700; t+=25) {
    const x = t<1000 ? .4*Math.sin(Math.PI*t/1000) : jitter ? .006*(-1)**(t/25) : 0
    await s.observeFeatures(previewFrame(t,{x}))
  }
  await s.finish()
}

test('small endpoint jitter does not keep a moving sign in preview',async()=>{
  for (const adaptive of [false,true]) {
    const s = adaptiveSession(()=>({label:'FRIDAY',score:.99}),adaptive)
    await replayMotion(s,true)
    assert.equal(s.state.transcript.length,adaptive?1:0)
    if(adaptive) assert.ok(s.state.transcript[0].decisionMs<=1275)
  }
})

test('the final label can recover a score dip when recent full previews strongly agree',async()=>{
  for (const rejectionReason of [undefined,'insufficient_hand_visibility']) {
    const s = adaptiveSession(t=>t>=1250 ? {label:'FRIDAY',score:.53,accepted:false,rejectionReason} : {label:'FRIDAY',score:.99})
    await replayMotion(s)
    assert.equal(s.state.transcript.length,rejectionReason?0:1)
    if(!rejectionReason) assert.equal(s.state.rows.find(row=>row.emit).reason,'gesture_completed_supported_low_score')
  }
})

test('a confidently different preview still blocks an unsupported final label',async()=>{
  const s = adaptiveSession(t=>({label:t>=1250?'FRIDAY':'SIX',score:.99}))
  await replayMotion(s)
  assert.equal(s.state.transcript.length,0)
  assert.equal(s.state.rows.find(row=>row.complete).reason,'completion_label_disagrees')
})

test('a strong completed moving sign can confirm without an earlier accepted preview',async()=>{
  const s = adaptiveSession(t=>({label:'FRIDAY',score:t>=1250?.99:.40,accepted:t>=1250}))
  await replayMotion(s)
  assert.equal(s.state.transcript.length,1)
  assert.equal(s.state.rows.find(row=>row.emit).reason,'gesture_completed_strong_motion')
})

test('a held pose can confirm after a smaller tracked release while staying provisional during the hold',async()=>{
  const s = adaptiveSession(()=>({label:'ONE',score:.99}))
  for(let t=0; t<=1600; t+=25){
    const y=t<=1100?.24:Math.min(.56,.24+(t-1100)*.0015)
    await s.observeFeatures(previewFrame(t,{y}))
    if(t<=1100) assert.equal(s.state.transcript.length,0)
  }
  assert.deepEqual(Array.from(s.state.transcript,entry=>entry.label),['ONE'])
  assert.ok(s.report().segmentationEvents.some(e=>e.reason==='held_pose_released'))
})

test('low-rate frames can verify an observed withdrawal but still reject a tracking jump',()=>{
  for(const observedDescent of [true,false]){
    const detector=createGestureSegmentation(150,true,{preview:true,fasterBoundaries:true})
    const positions=[.45,.4,.35,.15,.02,.05,.1,.17,.35,observedDescent?.45:.36,.58,.9,.9,.9]
    if(!observedDescent) positions[8]=positions[9]=.17
    const events=positions.flatMap((y,i)=>detector.push(frame(i*160,y,i<=10)).events)
    assert.equal(events.some(e=>e.reason==='observed_withdrawal'),observedDescent)
    if(!observedDescent) assert.ok(events.some(e=>e.reason==='unverified_hand_loss'))
  }
})
