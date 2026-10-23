const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), React = require('react')
function service(relative) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../src',relative+'.ts'),'utf8'),
    { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020} }).outputText,{ exports })
  return exports
}
const shortcuts = service('services/dataset/collectorShortcuts')
test('shortcut mapping covers the agreed keys and protects typing, composition and native controls', () => {
  const expected = { ' ':'play-interval', q:'previous', e:'next', c:'review', s:'save', r:'remove', t:'loop', f:'start', g:'end', y:'suggest', '?':'help' }
  for (const [key,action] of Object.entries(expected)) assert.equal(shortcuts.collectorShortcut({key}),action)
  for (const [key,action] of [[' ','play-whole'],['C','review-all'],['S','save-all'],['R','remove-all']]) assert.equal(shortcuts.collectorShortcut({key,shiftKey:true}),action)
  for (const flag of ['ctrlKey','metaKey','altKey','isComposing','repeat','defaultPrevented']) assert.equal(shortcuts.collectorShortcut({key:'s',[flag]:true}),null)
  assert.equal(shortcuts.collectorShortcut({key:'c',target:{closest:()=>({})}}),null)
  const button = { closest: selector => selector === 'button, a, summary' ? {} : null }
  assert.equal(shortcuts.collectorShortcut({key:' ',target:button}),'play-interval')
  assert.equal(shortcuts.collectorShortcut({key:' ',shiftKey:true,target:button}),'play-whole')
  assert.equal(shortcuts.adjustedIntervalTime(.1,-1,true,3),0)
  assert.equal(shortcuts.adjustedIntervalTime(2.9,1,true,3),3)
  assert.equal(shortcuts.adjustedIntervalTime(.1,1,false,3),.15)
})

function previewHarness({realReplay=false}={}) {
  const slots=[], effects=[]; let cursor=0, dirty=false, tree
  const listeners = new Map()
  const video = { currentTime:0,paused:true,ended:false,seeking:false,videoWidth:0,
    play(){ this.paused=false; return Promise.resolve() },pause(){ this.paused=true },
    addEventListener(name,fn){ const group=listeners.get(name)??new Set(); group.add(fn); listeners.set(name,group) },
    removeEventListener(name,fn){listeners.get(name)?.delete(fn)},
    emit(name){for(const fn of [...(listeners.get(name)??[])]) fn()},
  }
  const changes=[], trims=[]
  const props={take:{file:{name:'sample.mp4'},label:'ONE',status:'Ready',result:{start:1,end:2,duration:4,frames:[],quality:{result:'Pass',findings:[],usableFrames:0,totalFrames:0}},fullResult:{frames:[],duration:4}},
    onDraftChange:(...args)=>changes.push(args),onTrim:(...args)=>trims.push(args),onHandsChange(){},onConfirmInterval(){}}
  const react={ ...React, useState(initial){const i=cursor++; if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,next=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;dirty=true}]},
    useRef(initial){return slots[cursor++]??={current:initial}},useMemo(fn){return fn()},
    useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old||!deps||deps.some((d,j)=>d!==old.deps[j])){slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn()})}},
  }
  const exports={}
  const source=fs.readFileSync(path.resolve(__dirname,'../src/components/collector/VideoUploadCollector.tsx'),'utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText
  let binding, disposed=0
  vm.runInNewContext(code+'\nexports.Preview = TakePreview',{exports,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},requestAnimationFrame:()=>0,cancelAnimationFrame(){},require(name){
    if(name==='react')return react
    if(name==='react/jsx-runtime')return require(name)
    if(name==='lucide-react')return {Keyboard:'svg'}
    if(name.endsWith('collectorShortcuts'))return shortcuts
    if(name.endsWith('videoDiagnostics'))return { reviewSignInterval:()=>({start:.5,end:2.5,reason:'test'}) }
    if(name.endsWith('videoIntervalReview'))return {isFullRecording:()=>false,intervalReviewMatches:()=>true}
    if(name.endsWith('videoPlayback'))return realReplay ? service('services/dataset/videoPlayback') : {bindVideoReplay:(v,start,end,onError,options)=>{binding={start,end,...options};return {check:()=>false,play:()=>v.play(),dispose:()=>{disposed++}}}}
    return {default:name.endsWith('Button')?'button':'section',__esModule:true}
  }})
  function nodes(){const found=[];function visit(n){if(!n||typeof n!=='object')return;found.push(n);React.Children.forEach(n.props?.children,visit)}visit(tree);return found}
  function render(){let count=0;do{dirty=false;cursor=0;tree=exports.Preview(props);const element=nodes().find(n=>n.type==='video');element.ref.current=video;effects.splice(0).forEach(fn=>fn());if(++count>20)throw Error('render loop')}while(dirty)}
  render()
  return {video,changes,trims,render,props,binding:()=>binding,disposed:()=>disposed,
    control:action=>nodes().find(n=>n.props?.['data-collector-shortcut']===action),
    press(action){this.control(action).props.onClick();render()},
    time(field,key,extra={}){this.control(field).props.onKeyDown({key,preventDefault(){},isDefaultPrevented:()=>false,nativeEvent:{},...extra});render()},
  }
}

test('preview playback switches between interval and whole recording, pauses and retains loop preference', () => {
  const h=previewHarness()
  h.press('play-interval');assert.equal(h.video.paused,false);assert.equal(h.video.currentTime,1)
  h.video.currentTime=1.5;h.press('play-interval');assert.equal(h.video.paused,true)
  h.press('play-interval');assert.equal(h.video.currentTime,1.5,'resume preserves position')
  h.press('loop');assert.equal(h.binding().loop,true)
  const disposed=h.disposed();h.press('play-whole');assert.ok(h.disposed()>disposed);assert.equal(h.video.currentTime,0)
  h.video.currentTime=3;h.press('play-whole');assert.equal(h.video.paused,true)
  h.press('play-whole');assert.equal(h.video.currentTime,3,'whole playback resumes')
  h.press('play-interval');assert.equal(h.video.currentTime,1);assert.equal(h.binding().loop,true)
})

test('time arrows and Enter update the draft and reprocess; suggested intervals remain editable', () => {
  const h=previewHarness()
  h.time('start','ArrowUp');assert.equal(h.changes.at(-1)[0],1.05)
  h.time('end','ArrowDown',{shiftKey:true});assert.equal(h.changes.at(-1)[1],1.5)
  h.time('end','Enter');assert.deepEqual(h.trims.at(-1),[1.05,1.5])
  h.time('end','Enter',{repeat:true});assert.equal(h.trims.length,1)
  h.press('suggest');assert.deepEqual(h.changes.at(-1),[.5,2.5])
  h.props.locked=true;h.render();h.time('start','ArrowUp');assert.deepEqual(h.changes.at(-1),[.5,2.5])
})

test('Play selected interval can replay after completion with the real playback binding',()=>{
  const h=previewHarness({realReplay:true})
  for(let i=0;i<3;i++) {
    h.press('play-interval');assert.equal(h.video.paused,false);assert.equal(h.video.currentTime,1)
    h.video.emit('pause');h.render()
    h.video.currentTime=2.05;h.video.emit('timeupdate');h.render()
    assert.equal(h.video.paused,true);assert.equal(h.video.currentTime,1)
  }
})

test('shortcut help uses a native modal with grouped keycaps and close actions', () => {
  let effect, closed=0
  const element={open:false,showModal(){this.open=true},close(){this.open=false}}
  const exports={}
  const source=fs.readFileSync(path.resolve(__dirname,'../src/components/collector/CollectorShortcutHelp.tsx'),'utf8')
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require(name){
      if(name==='react')return {useRef:()=>({current:element}),useEffect:fn=>{effect=fn}}
      if(name==='react/jsx-runtime')return require(name)
      if(name==='lucide-react')return {Keyboard:'svg',X:'svg'}
      return shortcuts
    }})
  const tree=exports.default({open:true,onClose:()=>closed++});effect()
  assert.equal(tree.type,'dialog');assert.equal(element.open,true)
  assert.equal(tree.props['aria-labelledby'],'collector-shortcuts-title')
  let prevented=false;tree.props.onCancel({preventDefault(){prevented=true}})
  assert.equal(prevented,true);assert.equal(closed,1)
  tree.props.onClick({target:element,currentTarget:element});assert.equal(closed,2)
  tree.props.onClick({target:{},currentTarget:element});assert.equal(closed,2,'content clicks keep the dialog open')
  exports.default({open:false,onClose:()=>closed++});effect();assert.equal(element.open,false)
})
