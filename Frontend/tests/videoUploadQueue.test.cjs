const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

function harness({ holdProcessing = false, suggestion = null, trimFails = false, trimRetake = false, training } = {}) {
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
  const pending = []
  const processingOptions = []
  const props = { label: 'HELLO', sequences: [], onBusy() {}, onSaved() { props.sequences = [...saved]; dirty = true } }
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
  vm.runInNewContext(code, { exports, AbortController, console, crypto: { randomUUID: () => `take-${++id}` }, require(name) {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return require(name)
    if (name.endsWith('videoIntervalReview')) return loadService(path.resolve(__dirname, '../src/services/dataset/videoIntervalReview.ts'))
    if (name.endsWith('videoDiagnostics')) return { automaticSignInterval: () => suggestion }
    if (name.endsWith('videoQuality')) return { assessBoundaryVideoQuality: () => ({ result: 'Pass', findings: [] }), assessVideoQuality: (_frames, _hands, _timing, window) => ({ result: window ? 'Pass' : 'Review', findings: [] }) }
    if (name.endsWith('datasetStorage')) return {
      getSequences: () => saved,
      saveSequence: sample => { saved.push(sample) },
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
  return { render, all, button, upload, saved: () => saved, pending, confirm, processingOptions,
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

test('row review, save, undo, re-save and remove keep queue and storage consistent', async () => {
  const h = harness(); await h.upload()
  assert.equal(h.all(n => n.type === 'details').length, 0, 'queue actions are directly visible')
  assert.ok(h.button('Download original video'))
  assert.equal(h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '')).length, 1)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  assert.equal(h.button('Remove from queue').props.disabled, false)
  h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  assert.equal(h.saved()[0].videoImport.intervalReview.choice, 'full-recording')
  assert.equal(h.check().props.disabled, true)
  assert.equal(h.button('Remove from queue').props.disabled, true)
  h.button('Remove from queue').props.onClick(); h.render()
  assert.ok(h.check(), 'saved queue row cannot be removed even through its handler')
  h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  assert.equal(h.check().props.checked, true)
  assert.equal(h.check().props.disabled, false)
  h.button('Save checked takes').props.onClick(); h.render()
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
  h.button('Save').props.onClick(); h.render()
  const sample = h.saved()[0]
  assert.equal(sample.label, 'REST')
  assert.equal(sample.training.taskId, 'rest-both')
  assert.equal(sample.videoImport.samplePurpose, 'rest')
  assert.equal(sample.videoImport.review.completeSample, true)
  assert.equal(sample.videoImport.review.completeSign, undefined)
  assert.equal(sample.videoImport.review.training.taskId, 'rest-both')
  assert.equal(sample.videoImport.processingVersion, 'boundary-test')
  h.button('Undo save').props.onClick(); h.render()
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
  h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved()[0].videoImport.origin, 'camera-recording')
  assert.equal(h.saved()[0].training.taskId, training.taskId)
})

test('a processed full recording requires an explicit interval decision before review', async () => {
  const h = harness(); await h.upload('hello.mp4', false)
  assert.equal(h.check().props.disabled, true)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  h.confirm()
  assert.equal(h.check().props.disabled, false)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.button('Save').props.onClick(); h.render()
  h.button('Undo save').props.onClick(); h.render()
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
  h.button('Save').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  assert.equal(status(), 'Reviewed')
  assert.equal(h.button('Save').props.disabled, false)
  h.check().props.onChange({ target: { checked: false } }); h.render()
  assert.equal(status(), 'Review')
  assert.equal(h.button('Save').props.disabled, true)
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.button('Save').props.onClick(); h.render()
  assert.equal(status(), 'Saved')
  h.button('Undo save').props.onClick(); h.render()
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
  h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved().length, 0)
  h.preview().props.onTrim(.1, .9); h.render()
  await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.check().props.disabled, true, 'reprocessing requires a fresh boundary choice')
  h.confirm()
  assert.equal(h.check().props.disabled, false)
  assert.equal(h.check().props.checked, false)
})

test('failed undo keeps the sample saved and protected from queue removal', async () => {
  const h = harness(); await h.upload()
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.button('Save').props.onClick(); h.render()
  h.failDelete(); h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  assert.equal(h.button('Remove from queue').props.disabled, true)
  assert.ok(h.all(n => n.props?.role === 'alert').length)
})

test('remove all clears checked unsaved takes and their preview while protecting saved samples', async () => {
  const h = harness(); await h.upload()
  h.check().props.onChange({ target: { checked: true } }); h.render()
  h.button('Save').props.onClick(); h.render()
  await h.upload('second.mp4')
  h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '') && !n.props.disabled)[0].props.onChange({ target: { checked: true } }); h.render()
  h.all(n => n.type === 'button' && n.props['aria-label'] === 'Preview / review')[1].props.onClick(); h.render()
  assert.equal(h.preview().props.take.file.name, 'second.mp4')
  h.button('Remove all from queue').props.onClick(); h.render()
  assert.equal(h.saved().length, 1)
  assert.equal(h.all(n => n.props?.type === 'checkbox' && /^Reviewed /.test(n.props['aria-label'] ?? '')).length, 1)
  assert.equal(h.preview(), undefined)
  assert.equal(h.button('Remove all from queue').props.disabled, true)
  h.button('Undo save').props.onClick(); h.render()
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
  assert.equal(h.check().props.disabled, true)
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
  h.button('Save checked takes').props.onClick(); h.render()
  assert.equal(h.saved()[0].videoImport.trimStartMs, 200)
  assert.equal(h.saved()[0].videoImport.intervalReview.selectionMethod, 'automatic')
  h.button('Undo save').props.onClick(); h.render()
  assert.equal(h.check().props.checked, true)
})

test('auto-use can be disabled independently of automatic reprocessing', async () => {
  const h = harness({ suggestion: { start: .2, end: .8 } }); h.render()
  h.all(n => n.props?.['aria-label'] === 'Automatically use trimmed intervals')[0].props.onChange({ target: { checked: false } }); h.render()
  await h.upload('manual-choice.mp4', false)
  assert.equal(h.processingOptions.length, 2)
  assert.equal(h.preview().props.take.result.start, .2)
  assert.equal(h.check().props.disabled, true)
  h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: true } }); h.render()
  assert.equal(h.check().props.checked, false)
  h.confirm()
  assert.equal(h.check().props.disabled, false)
})

test('disabling auto-trim retains the original and does not reprocess', async () => {
  const h = harness({ suggestion: { start: .2, end: .8 } }); h.render()
  h.all(n => n.props?.['aria-label'] === 'Auto-trim and reprocess new recordings')[0].props.onChange({ target: { checked: false } }); h.render()
  await h.upload('full.mp4', false)
  assert.equal(h.processingOptions.length, 1)
  assert.equal(h.preview().props.take.result.start, 0)
  assert.equal(h.check().props.disabled, true)
})

test('automatic processing failure or unusable trim retains full recording with manual approval', async () => {
  for (const options of [{ trimFails: true }, { trimRetake: true }]) {
    const h = harness({ suggestion: { start: .2, end: .8 }, ...options }); await h.upload('fallback.mp4', false)
    assert.equal(h.preview().props.take.result.start, 0)
    assert.match(h.preview().props.take.message, /Full recording retained/)
    assert.equal(h.check().props.disabled, true)
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
  h.all(n => n.props?.['aria-label'] === 'Check or uncheck all previews')[0].props.onChange({ target: { checked: true } }); h.render()
  const checks = () => h.all(n => /^Reviewed /.test(n.props?.['aria-label'] ?? ''))
  assert.equal(checks()[0].props.checked, true)
  assert.equal(checks()[1].props.checked, false)
  assert.equal(master().props.checked, true, 'all eligible takes checked; unconfirmed takes excluded')
  h.button('Save checked takes').props.onClick(); h.render()
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
