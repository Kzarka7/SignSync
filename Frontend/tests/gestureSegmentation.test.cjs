const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path')
const load=require('../scripts/loadTypeScript.cjs')
const {createGestureSegmentation}=load(path.resolve('src/services/landmarks/gestureSegmentation.ts'))
const {createDiagnosticSession}=load(path.resolve('src/services/landmarks/recognitionDiagnostics.ts'))
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

test('completed gesture and fresh visible-hand motion allow a repeated sign; holding still does not',async()=>{
  for(const source of ['video','camera']) {
    const s=createDiagnosticSession({source,name:'repeat',recognitionMode:'segmented',segmentAcceptance:'confirmation',
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
