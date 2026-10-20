const {test}=require('node:test')
const assert=require('node:assert/strict')
const {hookHarness}=require('./helpers/hookHarness.cjs')

function setup(){
  const entries=[], sessions=[], transports=[]
  const feed={enabled:true,cameraReady:true,poseDetected:true,error:null,modelError:null}
  const h=hookHarness('src/hooks/useContinuousLiveRecognition.ts','useContinuousLiveRecognition',name=>{
    if(name.endsWith('/useCameraFeed'))return {useCameraFeed:()=>feed}
    if(name.endsWith('/diagnosticPredictor'))return {createDiagnosticPredictor:()=>{
      let resolve
      const transport={connect:()=>new Promise(done=>{resolve=done}),ready:()=>resolve({}),predict:async()=>{},close(){this.closed=true}}
      transports.push(transport);return transport
    }}
    if(name.endsWith('/recognitionDiagnostics'))return {createDiagnosticSession:options=>{
      assert.equal(options.recognitionMode,'segmented');assert.equal(options.segmentAcceptance,'confirmation')
      const session={active:true,state:{transcript:[],status:'Observing',segmentationPhase:'recording'},
        notify:options.onChange,stop(){this.active=false;options.onChange()},observe:async()=>{}}
      sessions.push(session);return session
    }}
    throw Error(name)
  },()=>[entry=>entries.push(entry)])
  h.render();return {h,entries,sessions,transports,feed}
}
test('live recognition forwards only confirmed entries once and ignores callbacks after stop',async()=>{
  const {h,entries,sessions,transports}=setup()
  const start=h.render().start();transports[0].ready();await start
  assert.equal(h.render().countdown,null)
  assert.equal(h.render().countdownSeconds,0)
  assert.equal(h.render().running,true)
  const s=sessions[0]
  s.notify();assert.equal(entries.length,0)
  s.state.transcript.push({requestId:'one',label:'YES',score:.99});s.notify();s.notify()
  assert.equal(entries.length,1)
  h.render().stop()
  s.state.transcript.push({requestId:'late',label:'NO',score:.99});s.notify()
  assert.equal(entries.length,1);assert.equal(transports[0].closed,true)
  h.unmount()
})
test('cancel during model loading cannot start a session later',async()=>{
  const {h,sessions,transports}=setup()
  const start=h.render().start();h.render().stop();transports[0].ready();await start
  assert.equal(sessions.length,0);assert.equal(h.render().running,false)
  h.unmount()
})
test('camera shutdown closes recognition and unmount ignores late results',async()=>{
  const {h,entries,sessions,transports,feed}=setup()
  const start=h.render().start();transports[0].ready();await start
  for(let i=0;i<3;i++)h.tickIntervals()
  feed.enabled=false;h.render()
  assert.equal(transports[0].closed,true);assert.equal(h.render().running,false)
  h.unmount();sessions[0].state.transcript.push({requestId:'late'});sessions[0].notify()
  assert.equal(entries.length,0)
})

test('Space starts the selected delay, Escape cancels, and typing or repeated keys do not start recognition',async()=>{
  const {h,sessions,transports}=setup()
  const space={key:' ',code:'Space',preventDefault(){}}
  h.dispatchKey({...space,repeat:true});assert.equal(transports.length,0)
  h.dispatchKey({...space,target:{closest:()=>true}});assert.equal(transports.length,0)
  h.render().setCountdownSeconds(1);h.render()
  h.dispatchKey(space);transports[0].ready();await new Promise(done=>setImmediate(done))
  assert.equal(h.render().countdown,1)
  h.dispatchKey({key:'Escape',preventDefault(){}});h.tickIntervals()
  assert.equal(h.render().countdown,null);assert.equal(sessions.length,0)
  h.dispatchKey(space);transports[1].ready();await new Promise(done=>setImmediate(done));h.tickIntervals()
  assert.equal(h.render().running,true)
  h.dispatchKey(space);assert.equal(h.render().running,false)
  h.unmount()
})
