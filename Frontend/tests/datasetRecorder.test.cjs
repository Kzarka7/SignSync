const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function recorderHarness(options = {}, storageOptions = {}) {
  const slots = [], pendingEffects = [], timers = new Map(), saved = [], listeners = new Map()
  let cursor = 0, nextTimer = 0, onFrame
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo: callback => callback(),
    useCallback: callback => callback,
    useEffect(callback, deps) {
      const index = cursor++, previous = slots[index]
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        pendingEffects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() } })
      }
    },
  }
  const feed = { enabled: true, cameraReady: true, startPerformanceProfile() {}, stopPerformanceProfile() {} }
  const exports = {}
  const setTimer = (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id }
  const source = fs.readFileSync(path.resolve(__dirname, '../src/hooks/useDatasetRecorder.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, console, Date, crypto: { randomUUID: () => `sample-${saved.length}` },
    setInterval: setTimer, clearInterval: id => timers.delete(id),
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    window: { addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) },
    require(name) {
      if (name === 'react') return react
      if (name === './useCameraFeed') return { useCameraFeed: settings => { onFrame = settings.onFrame; return feed } }
      if (name.endsWith('datasetStorage')) return {
        getSequences: () => [], saveSequence: sample => { if (storageOptions.failSave) throw new Error('Storage full'); saved.push(sample) }, clearSequences() {}, deleteSequence() {},
      }
      if (name.endsWith('boundaryEvaluation')) return {}
      if (name.endsWith('datasetExport')) return {}
      throw new Error('Unexpected dependency ' + name)
    },
  })
  return {
    saved, timers,
    render(nextOptions = options) {
      cursor = 0
      const result = exports.useDatasetRecorder(nextOptions)
      pendingEffects.splice(0).forEach(effect => effect())
      return result
    },
    frame(timestamp) { onFrame({ timestamp, pose: null, leftHand: null, rightHand: null }) },
    fire(ms) { const timer = [...timers.values()].find(timer => timer.ms === ms); assert.ok(timer); timer.callback() },
    key(code, tagName = 'BODY') { listeners.get('keydown')({ code, target: { tagName }, preventDefault() {} }) },
  }
}

const collection = { kind: 'idle', protocol: 'idle-v1',
  hands: 'both', posture: 'near_waist', palmOrientation: 'natural', targetDurationMs: 3000 }

test('evaluation tabs show and clear only their own captures', () => {
  const idle = { scope: 'evaluation', evaluationGroup: 'idle', durationLimitMs: 3000,
    evaluation: { protocol: 'boundary-pilot-v1', taskId: 'no-sign-extra-idle_left_near_waist', participantId: 'P1', sessionId: 'one', notes: '' } }
  const pilot = { scope: 'evaluation', evaluationGroup: 'pilot',
    evaluation: { ...idle.evaluation, taskId: 'HELP-normal' } }
  const h = recorderHarness(idle)
  let recorder = h.render()
  recorder.setCountdownSeconds(0)
  recorder.setSelectedLabel('IDLE')
  recorder = h.render()
  recorder.startRecording()
  h.frame(0); h.frame(2800)
  h.fire(3000)
  assert.equal(h.render().sequences.length, 1)
  recorder = h.render(pilot)
  assert.equal(recorder.sequences.length, 0)
  recorder.setSelectedLabel('HELP')
  recorder = h.render(pilot)
  recorder.startRecording()
  h.frame(0); h.frame(4000)
  recorder.stopRecording()
  assert.equal(h.render(pilot).sequences.length, 1)
  recorder = h.render(idle)
  assert.equal(recorder.sequences[0].label, 'IDLE')
  recorder.clearAll()
  assert.equal(h.render(idle).sequences.length, 0)
  assert.equal(h.render(pilot).sequences[0].label, 'HELP')
})

test('idle auto-stop saves once with context captured at start and clears its timer', () => {
  const h = recorderHarness({ collection, durationLimitMs: 3000 })
  let recorder = h.render()
  recorder.setSelectedLabel('IDLE')
  recorder.setCountdownSeconds(0)
  recorder = h.render()
  recorder.startRecording()
  recorder.startRecording() // repeated trigger must not clear the current buffer
  h.frame(100); h.frame(1500); h.frame(2900)
  h.render({ collection: { ...collection, hands: 'left' }, durationLimitMs: 3000 })
  h.fire(3000)
  recorder.stopRecording()
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].label, 'IDLE')
  assert.equal(h.saved[0].collection.hands, 'both')
  assert.equal(Object.hasOwn(h.saved[0].collection, 'participantId'), false)
  assert.equal(h.saved[0].frames.length, 3)
  assert.equal(h.timers.size, 0)
})

test('a disallowed recording stays blocked even through the Space shortcut', () => {
  const h = recorderHarness({ recordingAllowed: false, durationLimitMs: 3000 })
  const recorder = h.render()
  recorder.startRecording()
  h.key('Space')
  assert.equal(h.timers.size, 0)
  assert.equal(h.saved.length, 0)
})

test('idle records and auto-saves without choosing a variation', () => {
  const h = recorderHarness({ collection: { kind: 'idle', protocol: 'idle-v1', targetDurationMs: 3000 }, durationLimitMs: 3000 })
  let recorder = h.render()
  recorder.setSelectedLabel('IDLE')
  recorder.setCountdownSeconds(0)
  recorder = h.render()
  recorder.startRecording()
  h.frame(0); h.frame(2800)
  h.fire(3000)
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].label, 'IDLE')
  assert.equal(Object.hasOwn(h.saved[0].collection, 'hands'), false)
  assert.equal(Object.hasOwn(h.saved[0].collection, 'posture'), false)
})

test('countdown starts the duration timer only after preparation and Escape discards from a button', () => {
  const h = recorderHarness({ collection, durationLimitMs: 3000 })
  h.render().setCountdownSeconds(3)
  h.render().startRecording()
  assert.equal([...h.timers.values()].some(timer => timer.ms === 3000), false)
  h.fire(1000); h.fire(1000); h.fire(1000)
  h.frame(0); h.frame(2800)
  h.render()
  h.key('Escape', 'BUTTON')
  assert.equal(h.saved.length, 0)
  assert.equal(h.timers.size, 0)
})

test('evaluation records a long no-sign clip with missing hands and freezes task metadata at start', () => {
  const evaluation = { protocol: 'boundary-pilot-v1', taskId: 'no-sign-1', participantId: 'P4', sessionId: 'pilot', notes: 'quiet rest' }
  const h = recorderHarness({ scope: 'evaluation', evaluation })
  let recorder = h.render()
  recorder.setSelectedLabel('NO_SIGN')
  recorder.setCountdownSeconds(0)
  recorder = h.render()
  recorder.startRecording()
  h.frame(0); h.frame(15000); h.frame(30000)
  assert.equal(h.saved.length, 0)
  evaluation.taskId = 'interruption-1'
  recorder.stopRecording()
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].durationMs, 30000)
  assert.equal(h.saved[0].evaluation.taskId, 'no-sign-1')
  assert.equal(h.saved[0].label, 'NO_SIGN')
  assert.equal(h.timers.size, 0)
})

test('short idle recordings are rejected while ordinary sign recordings keep manual duration', () => {
  for (const idle of [true, false]) {
    const h = recorderHarness(idle ? { collection, durationLimitMs: 3000 } : {})
    h.render().setCountdownSeconds(0)
    const recorder = h.render()
    recorder.startRecording()
    h.frame(0); h.frame(500)
    recorder.stopRecording()
    assert.equal(h.saved.length, idle ? 0 : 1)
    if (idle) assert.match(h.render().saveError, /at least 2 seconds/)
    assert.equal(h.timers.size, 0)
  }
})


test('training freezes batch metadata and scopes captures and clearing to batch/category', () => {
  const metadata = { protocol: 'separate-training-v1', batchId: 'batch-a', participantId: 'P1', category: 'rest', taskId: 'rest-left', taskTitle: 'Left hand' }
  const options = { training: metadata, trainingBatchId: 'batch-a', trainingCategory: 'rest', durationLimitMs: 3000 }
  const h = recorderHarness(options)
  let recorder = h.render()
  recorder.setSelectedLabel('REST'); recorder.setCountdownSeconds(0)
  recorder = h.render(); recorder.startRecording()
  for (let t = 0; t <= 2800; t += 350) h.frame(t)
  h.render({ ...options, training: { ...metadata, participantId: 'P2' } })
  h.fire(3000)
  recorder = h.render()
  assert.equal(recorder.lastSavedSequence.training.participantId, 'P1')
  assert.equal(recorder.sequences.length, 1)
  const other = { trainingBatchId: 'batch-b', trainingCategory: 'sign', training: { ...metadata, batchId: 'batch-b', participantId: 'P2', category: 'sign', taskId: 'HELP-v1-normal' } }
  recorder = h.render(other); assert.equal(recorder.sequences.length, 0)
  recorder.setSelectedLabel('HELP'); recorder = h.render(other); recorder.startRecording()
  for (let t = 0; t <= 1000; t += 100) h.frame(t)
  recorder.stopRecording()
  recorder = h.render(other); assert.equal(recorder.sequences.length, 1)
  recorder.clearAll()
  assert.equal(h.render(other).sequences.length, 0)
  assert.equal(h.render(options).sequences.length, 1)
})

test('short, discarded and failed training captures do not emit a successful-save event', () => {
  const options = { trainingBatchId: 'batch-a', trainingCategory: 'rest', durationLimitMs: 3000,
    training: { protocol: 'separate-training-v1', batchId: 'batch-a', participantId: 'P1', category: 'rest', taskId: 'rest-left', taskTitle: 'Left hand' } }
  const storageOptions = {}
  const h = recorderHarness(options, storageOptions)
  let recorder = h.render(); recorder.setSelectedLabel('REST'); recorder.setCountdownSeconds(0)
  recorder = h.render(); recorder.startRecording(); h.frame(0); h.frame(500); recorder.stopRecording()
  assert.equal(h.render().lastSavedSequence, null)
  recorder = h.render(); recorder.startRecording()
  for (let t = 0; t <= 2800; t += 350) h.frame(t)
  recorder.discardRecording()
  assert.equal(h.render().lastSavedSequence, null)
  storageOptions.failSave = true
  recorder = h.render(); recorder.startRecording()
  for (let t = 0; t <= 2800; t += 350) h.frame(t)
  h.fire(3000)
  assert.equal(h.render().lastSavedSequence, null)
  assert.equal(h.saved.length, 0)
  assert.match(h.render().saveError, /Could not save/)
})


test('optional durations auto-save all categories and unselected duration waits for manual stop', () => {
  for (const category of ['sign', 'rest', 'idle_movement']) {
    for (const durationLimitMs of [undefined, 1000, 3000, 5000]) {
      const training = category === 'sign' ? undefined : {
        protocol: 'separate-training-v1', category, taskId: `${category}-task`, taskTitle: category,
      }
      const h = recorderHarness({ training, durationLimitMs })
      let recorder = h.render()
      recorder.setCountdownSeconds(0)
      recorder = h.render(); recorder.startRecording()
      const captureDuration = durationLimitMs ?? 6000
      for (let t = 0; t < captureDuration; t += 100) h.frame(t)
      assert.equal(h.saved.length, 0)
      if (durationLimitMs) h.fire(durationLimitMs)
      else {
        assert.equal([...h.timers.values()].some(timer => [1000, 3000, 5000].includes(timer.ms)), false)
        recorder.stopRecording()
      }
      assert.equal(h.saved.length, 1, `${category}: ${durationLimitMs ?? 'manual'}`)
      assert.equal(h.render().saveError, null)
      assert.equal(h.timers.size, 0)
    }
  }
})

test('restored sign collector records manually and keeps non-sign samples out of its list and clear action', () => {
  const rest = { trainingCategory: 'rest', durationLimitMs: 3000, training: { protocol: 'separate-training-v1', category: 'rest', taskId: 'rest-left', taskTitle: 'Resting' } }
  const h = recorderHarness(rest)
  let recorder = h.render(); recorder.setSelectedLabel('REST'); recorder.setCountdownSeconds(0)
  recorder = h.render(); recorder.startRecording()
  for (let t=0; t<=2800; t+=350) h.frame(t)
  h.fire(3000)
  const sign = { signsOnly: true }
  recorder = h.render(sign)
  assert.equal(recorder.sequences.length, 0)
  assert.equal(recorder.knownLabels.includes('REST'), false)
  recorder.setSelectedLabel('THANK_YOU')
  recorder = h.render(sign); recorder.startRecording()
  h.frame(0); h.frame(1500); h.frame(3500)
  assert.equal([...h.timers.values()].some(timer => timer.ms === 3000), false)
  recorder.stopRecording()
  recorder = h.render(sign)
  assert.equal(recorder.sequences.length, 1)
  assert.equal(recorder.sequences[0].label, 'THANK_YOU')
  recorder.clearAll()
  assert.equal(h.render(sign).sequences.length, 0)
  assert.equal(h.render(rest).sequences.length, 1)
})
