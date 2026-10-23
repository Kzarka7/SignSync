const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

// Exercise each collector's real capture/handoff handlers without media inference.
function harness(boundary) {
  const slots = []; let cursor = 0, effects = [], dirty = false, tree, id = 0
  const empty = []
  let recorderOptions
  const recorder = {
    knownLabels: ['HELLO', 'THANK_YOU'], selectedLabel: 'HELLO', sequences: empty, allSequences: empty,
    async clearAll() { recorder.sequences = []; recorder.allSequences = []; dirty = true },
    isRecording: false, countdown: null, countdownSeconds: 0,
    feed: { enabled: false, toggleCamera() {} },
    setSelectedLabel(label) { if (recorder.selectedLabel !== label) { recorder.selectedLabel = label; dirty = true } },
  }
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
    useMemo(fn) { return fn() },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i]
      if (!previous || deps.some((value, j) => value !== previous.deps[j])) {
        slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect() })
      }
    },
  }
  const exports = {}, name = boundary ? 'BoundarySampleCollector' : 'SignSampleCollector'
  const source = fs.readFileSync(path.resolve(__dirname, '../src/components/collector', name + '.tsx'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    exports, crypto: { randomUUID: () => `capture-${++id}` }, require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return require(name)
      if (name.endsWith('useDatasetRecorder')) return { useDatasetRecorder: options => { recorderOptions=options; return recorder } }
      if (name.endsWith('datasetStorage')) return { getSequences: () => empty }
      if (name.endsWith('trainingCollection')) return {
        getTrainingTasks: (_, category) => [{ id: `${category}-task`, category, label: category === 'rest' ? 'REST' : 'IDLE_MOVEMENT',
          title: `${category} task`, instruction: 'Test task', target: 3 }],
        trainingTaskCount: () => 0, nextTrainingTask: () => '',
      }
      return { __esModule: true, default: name.split('/').pop() }
    },
  })
  const props = { onLocked() {} }
  function render() {
    let tries = 0
    do {
      dirty = false; cursor = 0; effects = []; tree = exports.default(props); effects.forEach(effect => effect())
      if (++tries > 30) throw Error('Render loop')
    } while (dirty)
  }
  function all(predicate, root = tree) {
    const found = []
    function visit(node) {
      if (!node || typeof node !== 'object') return
      if (predicate(node)) found.push(node)
      React.Children.forEach(node.props?.children, visit)
    }
    visit(root); return found
  }
  const child = name => all(node => node.type === name)[0]
  render()
  return {
    render, child, recorderOptions:()=>recorderOptions,
    method(value) { all(node=>node.type==='select' && ['video','live'].includes(node.props.value))[0].props.onChange({target:{value}});render() },
    capture(filename) {
      const camera = child('CameraVideoRecorder')
      camera.props.onRecorded({ name: filename }, camera.props.label, 30); render()
    },
    selectNext() {
      if (boundary) all(node => node.type === 'button' && node.props.children === 'Idle movements')[0].props.onClick()
      else recorder.setSelectedLabel('THANK_YOU')
      render()
    },
    source(value) {
      const controls = child('VideoUploadCollector').props.controls
      all(node => node.type === 'button' && node.props.children === value, controls)[0].props.onClick(); render()
    },
  }
}

for (const boundary of [false, true]) {
  const category = boundary ? 'rest/idle' : 'sign'
  test(`${category} enables live recording shortcuts only in live-camera mode`,()=>{
    const h=harness(boundary)
    assert.equal(h.recorderOptions().hotkeysEnabled,false)
    h.method('live');assert.equal(h.recorderOptions().hotkeysEnabled,true)
    h.source('Upload videos');assert.equal(h.recorderOptions().hotkeysEnabled,false)
    h.source('Camera');assert.equal(h.recorderOptions().hotkeysEnabled,true)
  })
  test(`${category} captures wait on the camera screen, retain labels/tasks and transfer only on Process all`, () => {
    const h = harness(boundary)
    h.capture('first.webm'); h.selectNext(); h.capture('second.webm')
    assert.ok(h.child('CameraVideoRecorder'), 'camera remains mounted between takes')
    const pending = h.child('SequenceList')
    assert.equal(pending.props.pendingVideos.length, 2)
    assert.equal(h.child('VideoUploadCollector').props.incoming.length, 0, 'nothing is submitted for inference automatically')
    assert.deepEqual(Array.from(pending.props.pendingVideos, take => take.label), boundary ? ['REST', 'IDLE_MOVEMENT'] : ['HELLO', 'THANK_YOU'])
    if (boundary) assert.deepEqual(Array.from(pending.props.pendingVideos, take => take.training.taskId), ['rest-task', 'idle_movement-task'])
    pending.props.onProcessVideos(); h.render()
    assert.equal(h.child('CameraVideoRecorder'), undefined)
    const upload = h.child('VideoUploadCollector')
    assert.equal(upload.props.incoming.length, 2)
    assert.equal(new Set(upload.props.incoming.map(take => take.id)).size, 2)
    upload.props.onIncomingConsumed(upload.props.incoming.map(take => take.id)); h.render()
    assert.equal(h.child('VideoUploadCollector').props.incoming.length, 0)
    h.source('Camera')
    assert.equal(h.child('SequenceList').props.pendingVideos.length, 0, 'processed batch cannot be resubmitted')
  })

  test(`${category} clearing saved samples leaves pending videos available for processing`, async () => {
    const h = harness(boundary)
    h.capture('keep.webm')
    const before = h.child('SequenceList').props.pendingVideos[0]
    await h.child('SequenceList').props.onClearAll(); h.render()
    assert.equal(h.child('SequenceList').props.pendingVideos[0], before)
    h.child('SequenceList').props.onProcessVideos(); h.render()
    assert.equal(h.child('VideoUploadCollector').props.incoming[0].file.name, 'keep.webm')
  })

  test(`${category} pending videos survive source changes, allow removal and block processing while recording`, () => {
    const h = harness(boundary)
    h.capture('keep.webm'); h.capture('remove.webm')
    h.source('Upload videos')
    assert.equal(h.child('VideoUploadCollector').props.incoming.length, 0, 'opening uploads does not submit pending captures')
    h.source('Camera')
    let pending = h.child('SequenceList')
    pending.props.onRemoveVideo(pending.props.pendingVideos[1].id); h.render()
    assert.equal(h.child('SequenceList').props.pendingVideos.length, 1)
    h.child('CameraVideoRecorder').props.onBusy(true); h.render()
    pending = h.child('SequenceList')
    assert.equal(pending.props.pendingLocked, true)
    pending.props.onProcessVideos(); h.render()
    assert.equal(h.child('VideoUploadCollector').props.incoming.length, 0)
    assert.equal(h.child('SequenceList').props.pendingVideos.length, 1)
    h.child('CameraVideoRecorder').props.onBusy(false); h.render()
    h.child('SequenceList').props.onProcessVideos(); h.render()
    assert.equal(h.child('VideoUploadCollector').props.incoming[0].file.name, 'keep.webm')
  })
}
