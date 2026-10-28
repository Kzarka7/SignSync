const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

function harness({ holdSave = false, failSave = false, holdProcessing = false, suggestion = null, trimFails = false, trimRetake = false, training } = {}) {
  const serviceCache = new Map()
  function loadService(file) {
    if (serviceCache.has(file)) return serviceCache.get(file)
    const exports = {}; serviceCache.set(file, exports)
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
      { exports, require: name => loadService(path.resolve(path.dirname(file), name + '.ts')) })
    return exports
  }
  const slots = []; let cursor = 0, dirty = false, effects = [], tree, id = 0
  let saved = [], failDelete = false
  const pendingSaves = []
  const pending = []
  const processingOptions = []
  const keyListeners = new Set()
  const props = { label: 'HELLO', knownLabels:['HELLO','THREE','THANK_YOU'], sequences: [], onBusy() {}, onSaved() { props.sequences = [...saved]; dirty = true } }
  if (training) { props.training = training; props.label = training.category === 'rest' ? 'REST' : 'IDLE_MOVEMENT' }
  const react = { ...React,
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, update => {
        const next = typeof update === 'function' ? update(slots[i].value) : update
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useEffect(effect, deps) {
      const i = cursor++, old = slots[i]
      if (!old || !deps || !old.deps || deps.some((value, j) => value !== old.deps[j])) {
        slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  const exports = {}
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/collector/VideoUploadCollector.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  vm.runInNewContext(code, { exports, AbortController, console, window: {
    addEventListener: (name, listener) => { if (name === 'keydown') keyListeners.add(listener) },
    removeEventListener: (name, listener) => keyListeners.delete(listener),
  }, crypto: { randomUUID: () => `take-${++id}` }, require(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return require(name)
    if (name === 'lucide-react') return { Keyboard: 'svg' }
    if (name.endsWith('videoIntervalReview')) return loadService(path.resolve(__dirname, '../src/services/dataset/videoIntervalReview.ts'))
    if (name.endsWith('collectorShortcuts')) return loadService(path.resolve(__dirname, '../src/services/dataset/collectorShortcuts.ts'))
    if (name.endsWith('videoDiagnostics')) return { automaticSignInterval: () => suggestion }
    if (name.endsWith('videoQuality')) return { assessBoundaryVideoQuality: () => ({ result: 'Pass', findings: [] }), assessVideoQuality: (_frames, _hands, _timing, window) => ({ result: window ? 'Pass' : 'Review', findings: [] }) }
    if (name.endsWith('datasetStorage')) return {
      hasSourceFingerprint: async fingerprint => saved.some(s => s.videoImport?.fingerprint === fingerprint),
      saveSequence: async sample => { if (holdSave) await new Promise(resolve => pendingSaves.push(resolve)); if (failSave) throw Error('QuotaExceededError: storage full'); saved.push(sample) },
      deleteSequence: id => { if (failDelete) throw Error('storage failure'); saved = saved.filter(s => s.id !== id) },
    }
    if (name.endsWith('videoImport')) return {
      fingerprintVideo: async file => file.name, IMPORT_FPS: 30, VIDEO_IMPORT_VERSION: 'test', BOUNDARY_IMPORT_VERSION: 'boundary-test',
      processVideo: async (_file, signal, onProgress, _interval, options) => {
        processingOptions.push(options)
        processingOptions[processingOptions.length - 1].interval = _interval
        if (holdProcessing) await new Promise(resolve => pending.push({ resolve, signal, onProgress }))
        if (_interval && trimFails) throw Error('decoder failed')
        return { frames: [{ timestamp: 0 }, { timestamp: 500 }], qualityWindow: options.qualityWindow, sampling: { effectiveTargetFps: 20, achievedFps: 20 }, quality: { result: _interval && trimRetake ? 'Retake' : 'Pass', findings: [] }, start: _interval?.start ?? 0, end: _interval?.end ?? 1, duration: 1, width: 640, height: 480 }
      },
    }
    return { default: name.endsWith('Button') ? 'button' : 'section', __esModule: true }
  } })
  function render() {
    let count = 0
    do {
      dirty = false; cursor = 0; effects = []; tree = exports.default(props)
      effects.forEach(effect => effect())
      if (++count > 30) throw Error('Render loop')
    } while (dirty)
    return tree
  }
  function all(predicate) {
    const found = []
    function visit(node) {
      if (!node || typeof node !== 'object') return
      if (predicate(node)) found.push(node)
      React.Children.forEach(node.props?.children, visit)
    }
    visit(tree); return found
  }
  function button(text) { return all(n => n.type === 'button' && (n.props['aria-label'] ?? n.props.children) === text)[0] }
  function confirm() { all(n => n.type?.name === 'TakePreview')[0]?.props.onConfirmInterval(); render() }
  async function upload(name = 'hello.mp4', confirmBoundaries = true) {
    render()
    all(n => n.props?.type === 'file')[0].props.onChange({ target: { files: [{ name }], value: '' } })
    render(); await new Promise(resolve => setImmediate(resolve)); render()
    if (confirmBoundaries) {
      const previews = all(n => n.type === 'button' && n.props['aria-label'] === 'Preview / review')
      previews[previews.length - 1].props.onClick(); render(); confirm()
    }
  }
  return { pendingSaves, allowSave: () => { failSave = false }, render, all, button, upload, saved: () => saved, pending, confirm, processingOptions,
    relabel(scope,label) {
      if (!button('Change label').props['aria-expanded']) { button('Change label').props.onClick();render() }
      all(n=>n.props?.labelText==='New sign label')[0].props.onSelectLabel(label);render()
      all(n=>n.props?.['aria-label']==='Takes to relabel')[0].props.onChange({target:{value:scope}});render()
      button('Apply label').props.onClick();render()
    },
    key: (key, extra = {}) => { const event = { key, preventDefault() {}, ...extra }; for (const listener of [...keyListeners]) listener(event); render() },
    selectTraining: value => { props.training = value; props.label = value.category === 'rest' ? 'REST' : 'IDLE_MOVEMENT'; render() },
    incoming: async item => {
      props.incoming = [item]; props.onIncomingConsumed = () => { props.incoming = []; dirty = true }
      render(); await new Promise(resolve => setImmediate(resolve)); render()
    },
    check: () => all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? ''))[0],
    preview: () => all(n => n.type?.name === 'TakePreview')[0],
    externalDelete: () => { saved = []; props.sequences = []; render() },
    failDelete: () => { failDelete = true },
  }
}

test('batch label correction preserves processing, intervals and reviews and saves corrected metadata',async()=>{
  const h=harness();await h.upload('first.mp4');await h.upload('second.mp4')
  h.key('C',{shiftKey:true})
  const before=h.preview().props.take, calls=h.processingOptions.length
  h.relabel('checked','THREE')
  const after=h.preview().props.take
  assert.equal(after.label,'THREE');assert.equal(after.reviewed,true)
  for(const key of ['id','file','fingerprint','result','fullResult','intervalReview','interval','qualityWindow','contextCandidate']) assert.equal(after[key],before[key],key+' is preserved')
  assert.equal(h.processingOptions.length,calls,'no inference runs again')
  assert.ok(h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??'')).every(n=>n.props['aria-label'].endsWith(' as THREE')&&n.props.checked))
  h.button('Save checked takes').props.onClick();await new Promise(resolve=>setImmediate(resolve));h.render()
  assert.equal(h.saved().length,2,'reviewed takes save immediately after relabeling')
  assert.ok(h.saved().every(s=>s.label==='THREE'&&s.videoImport.review.label==='THREE'))
  assert.equal(h.saved()[1].frames,before.result.frames)
  await h.upload('third.mp4');assert.equal(h.preview().props.take.label,'HELLO','import default remains separate')
})

test('current/all relabel scopes protect saved takes and reject invalid labels without clearing review',async()=>{
  const h=harness();await h.upload('saved.mp4');h.key('c');h.key('s');await new Promise(resolve=>setImmediate(resolve));h.render()
  await h.upload('current.mp4');h.key('c')
  h.relabel('current','THREE');assert.equal(h.preview().props.take.label,'THREE')
  assert.equal(h.preview().props.take.reviewed,true,'label change preserves review')
  h.relabel('current','THREE');assert.equal(h.preview().props.take.reviewed,true,'same label is a no-op')
  h.relabel('all','UNKNOWN');assert.equal(h.preview().props.take.reviewed,true)
  assert.equal(h.preview().props.take.label,'THREE')
  await h.upload('other.mp4');h.relabel('all','THANK_YOU')
  assert.equal(h.saved()[0].label,'HELLO')
  const rows=h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??''))
  assert.equal(rows[0].props['aria-label'],'Reviewed saved.mp4 as HELLO')
  assert.ok(rows.slice(1).every(n=>n.props['aria-label'].endsWith(' as THANK_YOU')))
  assert.equal(rows[1].props.checked,true,'reviewed takes remain reviewed')
  assert.equal(rows[2].props.checked,false,'unreviewed takes still require review')
})

test('collector shortcuts navigate, review and save with batch eligibility and typing guards', async () => {
  const h = harness(); await h.upload('first.mp4'); await h.upload('second.mp4')
  h.key('q'); assert.equal(h.preview().props.take.file.name,'first.mp4')
  h.key('c',{ repeat:true }); assert.equal(h.check().props.checked,false)
  h.key('c',{ target:{ closest:()=>({}) } }); assert.equal(h.check().props.checked,false)
  h.key('c'); assert.equal(h.check().props.checked,true)
  h.key('s'); await new Promise(resolve=>setImmediate(resolve)); h.render()
  assert.equal(h.saved().length,1)
  h.key('e'); assert.equal(h.preview().props.take.file.name,'second.mp4')
  h.preview().props.onDraftChange(.1,.9); h.render()
  h.key('C',{shiftKey:true}); h.key('s')
  await new Promise(resolve=>setImmediate(resolve)); h.render()
  assert.equal(h.saved().length,1,'dirty takes cannot be reviewed or saved')
  h.preview().props.onTrim(.1,.9); h.render()
  await new Promise(resolve=>setImmediate(resolve)); h.render()
  h.key('C',{shiftKey:true}); h.key('C',{shiftKey:true})
  assert.equal(h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??''))[1].props.checked,false,'Shift+C unchecks on the second press')
  h.key('C',{shiftKey:true})
  h.key('S',{shiftKey:true}); await new Promise(resolve=>setImmediate(resolve)); h.render()
  assert.equal(h.saved().length,2)
  h.key('?'); assert.equal(h.all(n=>n.props?.open===true && typeof n.props?.onClose==='function').length,1)
  h.key('?'); assert.equal(h.all(n=>n.props?.open===true && typeof n.props?.onClose==='function').length,0)
})

test('processing shortcuts stay inactive when its workspace is hidden in camera mode', async () => {
  const h=harness();await h.upload()
  const workspace=h.all(n=>n.props?.['data-collector-workspace'])[0]
  workspace.ref.current={closest:()=>({hidden:true})}
  h.key('c');assert.equal(h.check().props.checked,false)
  h.key('?');assert.equal(h.all(n=>n.props?.open===true && typeof n.props?.onClose==='function').length,0)
  workspace.ref.current={closest:()=>null}
  h.key('c');assert.equal(h.check().props.checked,true)
})

test('R removes and restores the selected take in order with its review and processing data',async()=>{
  const h=harness();await h.upload('first.mp4');await h.upload('middle.mp4');await h.upload('last.mp4')
  h.key('q');h.key('c')
  const original=h.preview().props.take
  h.key('r');assert.equal(h.preview(),undefined)
  assert.equal(h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??'')).length,2)
  h.key('r')
  assert.equal(h.preview().props.take.id,original.id)
  assert.equal(h.preview().props.take.result,original.result)
  assert.equal(h.preview().props.take.reviewed,true)
  assert.deepEqual(h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??'')).map(n=>n.props['aria-label']),
    ['Reviewed first.mp4 as HELLO','Reviewed middle.mp4 as HELLO','Reviewed last.mp4 as HELLO'])
  h.key('r');h.key('r');assert.equal(h.preview().props.take.id,original.id)
})

test('Shift+R removes and restores unsaved takes while protecting saved samples',async()=>{
  const h=harness();await h.upload('saved.mp4');h.key('c');h.key('s')
  await new Promise(resolve=>setImmediate(resolve));h.render()
  h.key('r');assert.equal(h.preview().props.take.status,'Saved')
  await h.upload('second.mp4');await h.upload('third.mp4')
  h.key('C',{shiftKey:true})
  h.key('R',{shiftKey:true});assert.equal(h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??'')).length,1)
  assert.equal(h.saved().length,1)
  h.key('R',{shiftKey:true})
  assert.equal(h.preview().props.take.file.name,'third.mp4')
  assert.equal(h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??'')).length,3)
  assert.equal(h.saved().length,1)
  assert.equal(h.preview().props.take.reviewed,true)
})

test('restoring an active take restarts processing and ignores the removed run',async()=>{
  const h=harness({holdProcessing:true});await h.upload('active.mp4',false)
  h.key('r');assert.equal(h.pending[0].signal.aborted,true)
  h.key('r');assert.equal(h.preview().props.take.status,'Queued')
  h.pending[0].onProgress(99);h.render();assert.equal(h.preview().props.take.progress,0)
  h.pending[0].resolve();await new Promise(resolve=>setImmediate(resolve));h.render()
  await new Promise(resolve=>setImmediate(resolve));h.render()
  assert.equal(h.pending.length,2);assert.equal(h.preview().props.take.status,'Processing')
  h.pending[1].resolve();await new Promise(resolve=>setImmediate(resolve));h.render()
  assert.equal(h.preview().props.take.status,'Ready')
  h.pending[0].onProgress(12);h.render();assert.equal(h.preview().props.take.progress,100)
})

test('restore does not bypass duplicate checks after the same source is imported again',async()=>{
  const h=harness();await h.upload('same.mp4');h.key('r');await h.upload('same.mp4')
  h.button('Undo remove (R)').props.onClick();h.render()
  assert.equal(h.preview().props.take.status,'Duplicate')
  assert.equal(h.check().props.disabled,true)
})

test('C toggles review and S saves, undoes and re-saves the current take',async()=>{
  const h=harness();await h.upload()
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));h.render()}
  h.key('c');assert.equal(h.check().props.checked,true)
  h.key('c');assert.equal(h.check().props.checked,false)
  h.key('s');await settle();assert.equal(h.saved().length,0,'unreviewed takes stay unsaved')
  h.key('c');h.key('s');await settle();assert.equal(h.saved().length,1)
  h.key('s');await settle();assert.equal(h.saved().length,0)
  assert.equal(h.preview().props.take.status,'Ready')
  assert.equal(h.check().props.checked,true,'undo retains review and source take')
  h.key('s');await settle();assert.equal(h.saved().length,1)
})

test('Shift+C toggles the batch and Shift+S saves or undoes only the queue saves',async()=>{
  const h=harness();await h.upload('first.mp4');await h.upload('second.mp4')
  const settle=async()=>{await new Promise(resolve=>setImmediate(resolve));h.render()}
  const checked=()=>h.all(n=>/^Reviewed /.test(n.props?.['aria-label']??'')).map(n=>n.props.checked)
  h.key('C',{shiftKey:true});assert.deepEqual(checked(),[true,true])
  h.key('C',{shiftKey:true});assert.deepEqual(checked(),[false,false])
  h.key('C',{shiftKey:true});h.key('S',{shiftKey:true});await settle();assert.equal(h.saved().length,2)
  h.saved().push({id:'outside-queue'})
  h.key('S',{shiftKey:true});await settle();assert.deepEqual(h.saved().map(s=>s.id),['outside-queue'])
  assert.deepEqual(checked(),[true,true])
  h.key('S',{shiftKey:true});await settle();assert.equal(h.saved().length,3,'batch can be re-saved')
  h.failDelete();h.key('S',{shiftKey:true});await settle()
  assert.equal(h.saved().length,3,'failed undo preserves saved samples')
  assert.ok(h.all(n=>n.props?.role==='alert').length)
})

test('Q/E center the selected take inside the queue without overriding manual scrolling',async()=>{
  const h=harness();await h.upload('first.mp4');await h.upload('second.mp4');await h.upload('third.mp4')
  const queue={scrollTop:0,clientTop:0,clientHeight:300,scrollHeight:480,getBoundingClientRect:()=>({top:100}),
    children:{item:index=>({getBoundingClientRect:()=>({top:100+160*index-queue.scrollTop,bottom:260+160*index-queue.scrollTop,height:160})})}}
  h.all(n=>n.props?.['aria-label']==='Review queue takes')[0].ref.current=queue
  const previews=()=>h.all(n=>n.type==='button'&&n.props['aria-label']==='Preview / review')
  previews()[0].props.onClick();h.render();assert.equal(queue.scrollTop,0)
  h.key('e');assert.equal(queue.scrollTop,90,'middle row is centered, not merely visible')
  h.key('e');assert.equal(queue.scrollTop,180)
  queue.scrollTop=0;h.render();assert.equal(queue.scrollTop,0,'manual scrolling survives render')
  h.key('c');assert.equal(queue.scrollTop,0,'review updates do not scroll')
  previews()[2].props.onClick();h.render();assert.equal(queue.scrollTop,0,'mouse selection does not scroll')
  h.key('q');assert.equal(queue.scrollTop,90)
  h.key('q');assert.equal(queue.scrollTop,0)
})

test('Space routes to interval playback and Shift+Space to whole playback without video focus',async()=>{
  const h=harness();await h.upload()
  const actions=[]
  h.all(n=>n.props?.['data-collector-workspace'])[0].ref.current={closest:()=>null,
    querySelector:selector=>({matches:()=>false,click:()=>actions.push(selector)})}
  for(const type of ['body','button','file','checkbox']) {
    const target={closest:()=>null,tagName:type==='body'?'BODY':type==='button'?'BUTTON':'INPUT',type}
    h.key(' ',{target});h.key(' ',{target,shiftKey:true})
  }
  assert.equal(actions.length,8)
  assert.ok(actions.every((selector,i)=>selector.includes(i%2?'play-whole':'play-interval')))
})

test('row review, save, undo, re-save and remove keep queue and storage consistent', async () => {
  const h = harness(); await h.upload()
  assert.equal(h.all(n => n.type === 'details').length, 0, 'queue actions are directly visible')
  assert.ok(h.button('Download original video'))
  assert.equal(h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '')).length, 1)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  assert.equal(h.button('Remove from queue').props.disabled, false)
  await h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  assert.equal(h.saved()[0].videoImport.intervalReview.choice, 'full-recording')
  assert.equal(h.check().props.disabled, true)
  assert.equal(h.button('Remove from queue').props.disabled, true)
  h.button('Remove from queue').props.onClick(); h.render()
  assert.ok(h.check(), 'saved queue row cannot be removed even through its handler')
  await h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  assert.equal(h.check().props.checked, true)
  assert.equal(h.check().props.disabled, false)
  await h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  h.externalDelete()
  assert.equal(h.check().props.checked, false)
  assert.equal(h.button('Remove from queue').props.disabled, false)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.button('Remove from queue').props.onClick(); h.render()
  assert.equal(h.check(), undefined, 'checked unsaved take can be removed')
})

test('non-sign uploads freeze task/category, preserve full clips and save bound approval; undo retains review', async () => {
  const training = { protocol: 'separate-training-v1', category: 'rest', taskId: 'rest-both', taskTitle: 'Rest both hands' }
  const h = harness({ training, suggestion: { start: .2, end: .8 } })
  await h.upload('rest.mp4', false)
  assert.equal(h.processingOptions.length, 1, 'motion-based sign trim must not run on rest/idle')
  assert.equal(h.processingOptions[0].samplePurpose, 'rest')
  assert.equal(h.processingOptions[0].targetFps, 30)
  assert.equal(h.all(n => n.props?.['aria-label'] === 'Auto-trim and reprocess new recordings').length, 0)
  h.selectTraining({ ...training, category: 'idle_movement', taskId: 'idle-movement-hair', taskTitle: 'Adjust hair' })
  h.confirm(); h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save').props.onClick(); h.render()
  const sample = h.saved()[0]
  assert.equal(sample.label, 'REST')
  assert.equal(sample.training.taskId, 'rest-both')
  assert.equal(sample.videoImport.samplePurpose, 'rest')
  assert.equal(sample.videoImport.review.completeSample, true)
  assert.equal(sample.videoImport.review.completeSign, undefined)
  assert.equal(sample.videoImport.review.training.taskId, 'rest-both')
  assert.equal(sample.videoImport.processingVersion, 'boundary-test')
  await h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.check().props.checked, true)
  assert.equal(h.saved().length, 0)
})

test('preserved idle recording keeps its frozen task through handoff and manual reprocessing', async () => {
  const training = { protocol: 'separate-training-v1', category: 'idle_movement', taskId: 'idle-movement-lap', taskTitle: 'Hands onto/off lap' }
  const h = harness({ training, suggestion: { start: .2, end: .8 } })
  await h.incoming({ id: 'camera-idle', file: { name: 'lap.webm' }, label: 'IDLE_MOVEMENT', fps: 30, training })
  assert.equal(h.processingOptions.length, 1)
  assert.equal(h.preview().props.take.training.taskId, training.taskId)
  h.preview().props.onTrim(.1, .9); h.render()
  await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.processingOptions.at(-1).samplePurpose, 'idle_movement')
  assert.equal(h.processingOptions.at(-1).qualityWindow, undefined)
  h.confirm(); h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved()[0].videoImport.origin, 'camera-recording')
  assert.equal(h.saved()[0].training.taskId, training.taskId)
})

test('a processed full recording is selected automatically but still requires sample review', async () => {
  const h = harness(); await h.upload('hello.mp4', false)
  assert.equal(h.check().props.disabled, false)
  assert.equal(h.preview().props.take.intervalReview.choice, 'full-recording')
  assert.equal(h.preview().props.take.intervalReview.selectionMethod, 'automatic')
  await h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save').props.onClick(); h.render()
  await h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.check().props.checked, true)
  h.preview().props.onDraftChange(.1, .9); h.render()
  assert.equal(h.check().props.disabled, true)
  h.preview().props.onConfirmInterval(); h.render()
  assert.equal(h.check().props.disabled, true, 'confirmation cannot approve unprocessed draft boundaries')
})

test('review status replaces the row label and unchecked samples cannot be saved', async () => {
  const h = harness(); await h.upload()
  const status = () => React.Children.toArray(h.all(n => n.props?.role === 'status')[0].props.children).join('')
  assert.equal(status(), 'Review')
  assert.equal(h.button('Save').props.disabled, true)
  await h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  assert.equal(status(), 'Reviewed')
  assert.equal(h.button('Save').props.disabled, false)
  h.check().props.onChange({ target: { checked: false } }); h.render()
  assert.equal(status(), 'Review')
  assert.equal(h.button('Save').props.disabled, true)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save').props.onClick(); h.render()
  assert.equal(status(), 'Saved')
  await h.button('Undo save').props.onClick(); h.render()
  assert.equal(status(), 'Reviewed')
  assert.equal(h.check().props.checked, true)
})

test('pending trim blocks row approval and save; successful reprocessing allows review', async () => {
  const h = harness(); await h.upload()
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.preview().props.onDraftChange(.1, .9); h.render()
  assert.equal(h.check().props.checked, false)
  assert.equal(h.check().props.disabled, true)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  h.preview().props.onTrim(.1, .9); h.render()
  await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.preview().props.take.intervalReview.selectionMethod, 'manual')
  assert.equal(h.check().props.disabled, false)
  assert.equal(h.check().props.checked, false)
})

test('failed undo keeps the sample saved and protected from queue removal', async () => {
  const h = harness(); await h.upload()
  h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save').props.onClick(); h.render()
  h.failDelete(); await h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  assert.equal(h.button('Remove from queue').props.disabled, true)
  assert.ok(h.all(n => n.props?.role === 'alert').length)
})

test('remove all clears checked unsaved takes and their preview while protecting saved samples', async () => {
  const h = harness(); await h.upload()
  h.check().props.onChange({ target: { checked: true } }); h.render()
  await h.button('Save').props.onClick(); h.render()
  await h.upload('second.mp4')
  h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '') && !n.props.disabled)[0].props.onChange({ target: { checked: true } }); h.render()
  h.all(n => n.type === 'button' && n.props['aria-label'] === 'Preview / review')[1].props.onClick(); h.render()
  assert.equal(h.preview().props.take.file.name, 'second.mp4')
  h.button('Remove all from queue').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  assert.equal(h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '')).length, 1)
  assert.equal(h.preview(), undefined)
  assert.equal(h.button('Remove all from queue').props.disabled, true)
  await h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.check().props.checked, true)
  h.button('Remove all from queue').props.onClick(); h.render()
  assert.equal(h.check(), undefined)
  await h.upload('second.mp4')
  assert.ok(h.button('Save'), 'removed fingerprints do not block re-upload')
})

test('remove all aborts active processing and ignores its late progress/result', async () => {
  const h = harness({ holdProcessing: true }); await h.upload()
  assert.equal(h.pending.length, 1)
  h.button('Remove all from queue').props.onClick(); h.render()
  assert.equal(h.pending[0].signal.aborted, true)
  h.pending[0].onProgress(75); h.pending[0].resolve()
  await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.check(), undefined)
  assert.equal(h.preview(), undefined)
  assert.equal(h.saved().length, 0)
})

test('camera handoff freezes the label, uses fixed 30 FPS and consumes an original only once', async () => {
  const h = harness(), item = { id: 'camera-1', file: { name: 'recorded.webm' }, label: 'THANK_YOU', fps: 60 }
  await h.incoming(item)
  assert.equal(h.preview().props.take.label, 'THANK_YOU')
  assert.equal(h.preview().props.take.origin, 'camera-recording')
  assert.equal(h.processingOptions[0].targetFps, 30)
  assert.equal(h.check().props.disabled, false)
  await h.incoming(item)
  assert.equal(h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '')).length, 1)
  assert.ok(h.button('Download original video'))
})

test('uploads use fixed 30 FPS without exposing a per-take FPS control', async () => {
  const h = harness(); await h.upload()
  assert.equal(h.processingOptions[0].targetFps, 30)
  assert.equal(h.preview().props.onFpsChange, undefined)
})

test('automatic trim reprocesses once and auto-use selects bounds without approving or saving', async () => {
  const h = harness({ suggestion: { start: .2, end: .8 } }); await h.upload('auto.mp4', false)
  assert.equal(h.processingOptions.length, 2)
  assert.equal(h.processingOptions[1].interval.start, .2)
  const take = h.preview().props.take
  assert.equal(take.result.start, .2)
  assert.equal(take.fullResult.start, 0)
  assert.equal(take.intervalReview.selectionMethod, 'automatic')
  assert.equal(h.check().props.disabled, false)
  assert.equal(h.check().props.checked, false)
  assert.equal(h.saved().length, 0)
  h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: true } }); h.render()
  assert.equal(h.check().props.checked, true)
  await h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved()[0].videoImport.trimStartMs, 200)
  assert.equal(h.saved()[0].videoImport.intervalReview.selectionMethod, 'automatic')
  await h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.check().props.checked, true)
})

test('start-only trim preserves the source ending and selects the interval automatically', async () => {
  const h = harness({ suggestion: { start: .2, end: 1, activityStartMs: 400, activityEndMs: 1000 } })
  await h.upload('start-only.mp4', false)
  assert.equal(h.processingOptions.length, 2)
  assert.equal(h.preview().props.take.result.start, .2)
  assert.equal(h.preview().props.take.result.end, 1)
  assert.equal(h.preview().props.take.intervalReview.selectionMethod, 'automatic')
  assert.equal(h.processingOptions[1].qualityWindow.endMs, 800)
  assert.equal(h.check().props.disabled, false)
  assert.equal(h.check().props.checked, false)
  assert.equal(h.saved().length, 0)
})

test('disabling auto-trim retains the original and does not reprocess', async () => {
  const h = harness({ suggestion: { start: .2, end: .8 } }); h.render()
  h.all(n => n.props?.['aria-label'] === 'Auto-trim and reprocess new recordings')[0].props.onChange({ target: { checked: false } }); h.render()
  await h.upload('full.mp4', false)
  assert.equal(h.processingOptions.length, 1)
  assert.equal(h.preview().props.take.result.start, 0)
  assert.equal(h.check().props.disabled, false)
})

test('automatic processing failure or unusable trim selects full recording for sample review', async () => {
  for (const options of [{ trimFails: true }, { trimRetake: true }]) {
    const h = harness({ suggestion: { start: .2, end: .8 }, ...options }); await h.upload('fallback.mp4', false)
    assert.equal(h.preview().props.take.result.start, 0)
    assert.match(h.preview().props.take.message, /Full recording retained/)
    assert.equal(h.check().props.disabled, false)
    assert.equal(h.preview().props.take.intervalReview.choice, 'full-recording')
    assert.equal(h.check().props.checked, false)
    assert.equal(h.saved().length, 0)
  }
})

test('check all skips unconfirmed and dirty previews; uncheck all keeps saved takes protected', async () => {
  const h = harness(); await h.upload('first.mp4')
  const master = () => h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0]
  assert.equal(master().props.checked, false)
  assert.equal(master().props.disabled, false)
  assert.equal(h.button('Check all previews'), undefined)
  assert.equal(h.button('Uncheck all previews'), undefined)
  await h.upload('second.mp4', false)
  h.all(n => n.type === 'button' && n.props['aria-label'] === 'Preview / review').at(-1).props.onClick(); h.render()
  h.preview().props.onDraftChange(0, 1); h.render()
  h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: true } }); h.render()
  const checks = () => h.all(n => /^Reviewed /.test(n.props?.['aria-label'] ?? ''))
  assert.equal(checks()[0].props.checked, true)
  assert.equal(checks()[1].props.checked, false)
  assert.equal(master().props.checked, true, 'all eligible takes checked; unconfirmed takes excluded')
  await h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(master().props.disabled, true, 'saved and unconfirmed takes cannot be bulk edited')
  h.confirm(); h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: true } }); h.render()
  h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: false } }); h.render()
  assert.equal(checks()[0].props.checked, true)
  assert.equal(checks()[1].props.checked, false)
  h.preview().props.onDraftChange(.2, .8); h.render()
  h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: true } }); h.render()
  assert.equal(checks()[1].props.checked, false)
})

test('cancelling the automatic second pass never leaves a selected or approved partial trim', async () => {
  const h = harness({ suggestion: { start: .2, end: .8 }, holdProcessing: true })
  await h.upload('cancel-auto.mp4', false)
  h.pending[0].resolve(); await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.pending.length, 2)
  h.button('Cancel remaining').props.onClick(); h.render()
  h.pending[1].resolve(); await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.preview().props.take.status, 'Cancelled')
  assert.equal(h.check().props.disabled, true)
  assert.equal(h.saved().length, 0)
})

test('manual reprocessing clears automatic context and keeps fixed 30 FPS', async () => {
  const h = harness({ suggestion: { start: .1, end: .9, activityStartMs: 300, activityEndMs: 700 } })
  await h.upload('context.mp4', false)
  assert.equal(h.processingOptions.at(-1).qualityWindow.startMs, 200)
  assert.equal(h.processingOptions.at(-1).targetFps, 30)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.preview().props.onTrim(0, 1); h.render()
  await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.check().props.checked, false)
  assert.equal(h.processingOptions.at(-1).qualityWindow, undefined)
  assert.equal(h.processingOptions.at(-1).targetFps, 30)
})


test('a take stays Saving until commit, rejects double saves, and failed saves remain retryable', async () => {
  const h = harness({ holdSave: true, failSave: true }); await h.upload()
  h.check().props.onChange({ target: { checked: true } }); h.render()
  const pending = h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  assert.equal(h.button('Undo save'), undefined)
  assert.equal(h.button('Save checked takes').props.disabled, true)
  assert.equal(h.button('Remove from queue').props.disabled, true)
  await h.button('Save checked takes').props.onClick()
  assert.equal(h.pendingSaves.length, 1)
  h.pendingSaves.shift()(); await pending; h.render()
  assert.equal(h.saved().length, 0)
  assert.equal(h.button('Save').props.disabled, false)
  assert.ok(h.all(n => n.props?.role === 'alert').some(n => String(n.props.children).includes('this take remains in the queue')))
  h.allowSave()
  const retry = h.button('Save').props.onClick(); h.render()
  h.pendingSaves.shift()(); await retry; h.render()
  assert.equal(h.saved().length, 1)
  assert.ok(h.button('Undo save'))
})
