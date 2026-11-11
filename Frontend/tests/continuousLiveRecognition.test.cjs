const {test}=require('node:test')
const assert=require('node:assert/strict')
const {hookHarness}=require('./helpers/hookHarness.cjs')
const load=require('../scripts/loadTypeScript.cjs'),path=require('node:path')

function setup(mode = 'signs', globals = {}){
  const entries=[], sessions=[], transports=[], wordBoundaries=[]
  let feedOptions
  const feed={enabled:true,cameraReady:true,poseDetected:true,error:null,modelError:null}
  const h=hookHarness('src/hooks/useContinuousLiveRecognition.ts','useContinuousLiveRecognition',name=>{
    if(name.endsWith('/liveRecognitionPolicy'))return load(path.resolve('src/services/landmarks/liveRecognitionPolicy.ts'), globals)
    if(name.endsWith('/useCameraFeed'))return {useCameraFeed:options=>{feedOptions=options;return feed}}
    if(name.endsWith('/diagnosticPredictor'))return {createDiagnosticPredictor:modelMode=>{
      let resolve
      const transport={modelMode,connect:()=>new Promise(done=>{resolve=done}),ready:()=>resolve({}),predict:async()=>{},close(){this.closed=true}}
      transports.push(transport);return transport
    }}
    if(name.endsWith('/recognitionDiagnostics'))return {createDiagnosticSession:options=>{
      assert.equal(options.recognitionMode,'segmented');assert.equal(options.segmentAcceptance,'confirmation')
      const session={active:true,state:{transcript:[],status:'Observing',segmentationPhase:'recording'},
        options,notify:options.onChange,stop(){this.active=false;options.onChange()},observe:async()=>{}}
      sessions.push(session);return session
    }}
    throw Error(name)
  },()=>[entry=>entries.push(entry), {mode,onWordBoundary:()=>wordBoundaries.push(entries.length)}])
  h.render();return {h,entries,sessions,transports,feed,feedOptions,wordBoundaries}
}
test('live camera collects timing for the paired hand and pose status',()=>{
  const {h,feedOptions}=setup()
  assert.equal(feedOptions.landmarkMode,'both')
  assert.equal(feedOptions.trackLiveTiming,true)
  h.unmount()
})
test('live recognition forwards only confirmed entries once and ignores callbacks after stop',async()=>{
  const {h,entries,sessions,transports}=setup()
  const start=h.render().start();transports[0].ready();await start
  assert.equal(h.render().countdown,null)
  assert.equal(h.render().countdownSeconds,0)
  assert.equal(h.render().running,true)
  const s=sessions[0]
  assert.equal(transports[0].modelMode,'lab-signs43-similarity')
  assert.equal(s.options.minimumConfidence,.75)
  assert.equal(s.options.settings.confirmationMs,300)
  assert.equal(s.options.onWordBoundary,undefined)
  s.notify();assert.equal(entries.length,0)
  s.state.transcript.push({requestId:'one',label:'YES',score:.99});s.notify();s.notify()
  assert.equal(entries.length,1)
  h.render().stop()
  s.state.transcript.push({requestId:'late',label:'NO',score:.99});s.notify()
  assert.equal(entries.length,1);assert.equal(transports[0].closed,true)
  h.unmount()
})

test('43 Similar Signs uses saved settings and sends confirmed signs to the conversation', async () => {
  const {h,entries,sessions,transports}=setup()
  const start=h.render().start();transports[0].ready();await start
  const s=sessions[0]
  assert.equal(transports[0].modelMode,'lab-signs43-similarity')
  assert.equal(s.options.modelMode,'lab-signs43-similarity')
  assert.equal(s.options.minimumConfidence,.75)
  assert.equal(s.options.settings.confirmationMs,300)
  assert.equal(s.options.settings.strideMs,150)
  assert.equal(s.options.settings.confirmationWindows,2)
  assert.equal(s.options.settings.confirmationHistory,4)
  assert.equal(s.options.waitForConfirmation,true)
  assert.equal(s.options.staticMotionCheck,true)
  assert.equal(s.options.onWordBoundary,undefined)
  s.state.transcript.push({requestId:'similar-one',label:'ONE',score:.92})
  s.notify();s.notify()
  assert.deepEqual(entries.map(entry=>entry.label),['ONE'])
  h.unmount()
})

test('fingerspelling uses saved timing and stops delivering letters and word boundaries when stopped',async()=>{
  const localStorage = { getItem: () => JSON.stringify({ minimumConfidence: 85, acceptanceMs: 100 }) }
  const {h,entries,sessions,transports,wordBoundaries}=setup('fingerspelling',{localStorage})
  const start=h.render().start();transports[0].ready();await start
  const s=sessions[0]
  assert.equal(transports[0].modelMode,'lab-alphabet')
  assert.equal(s.options.modelMode,'lab-alphabet')
  assert.equal(s.options.minimumConfidence,.85)
  assert.equal(s.options.settings.confirmationMs,100)
  assert.equal(s.options.settings.confirmationWindows,2)
  assert.equal(s.options.settleConfirmedHold,true)
  for (const [i,label] of [...'MAYA'].entries()) {
    s.state.transcript.push({requestId:String(i),label,score:.99})
    s.notify()
  }
  s.options.onWordBoundary()
  assert.equal(entries.map(entry=>entry.label).join(''),'MAYA')
  assert.deepEqual(wordBoundaries,[4])
  h.render().stop()
  s.options.onWordBoundary()
  s.state.transcript.push({requestId:'late',label:'X',score:.99});s.notify()
  assert.equal(entries.length,4)
  assert.deepEqual(wordBoundaries,[4])
  h.unmount()
})

test('each new recognition run reads the latest saved settings', async () => {
  const stored = new Map()
  const localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
  const preferences = load(path.resolve('src/services/recognitionSettings.ts'), { localStorage })
  const {h,sessions,transports}=setup('signs',{localStorage})
  const first = h.render().start()
  preferences.updateRecognitionSettings({ minimumConfidence: 100, acceptanceMs: 1000 })
  transports[0].ready()
  await first
  assert.equal(sessions[0].options.minimumConfidence,.75)
  assert.equal(sessions[0].options.settings.confirmationMs,300)
  h.render().stop()
  const second = h.render().start()
  transports[1].ready()
  await second
  assert.equal(sessions[1].options.minimumConfidence,1)
  assert.equal(sessions[1].options.settings.confirmationMs,1000)
  assert.equal(sessions[1].options.settings.confirmationWindows,7)
  preferences.updateRecognitionSettings({ minimumConfidence: 50 })
  assert.equal(preferences.getRecognitionSettings().minimumConfidence,50)
  assert.equal(preferences.getRecognitionSettings().acceptanceMs,1000)
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
