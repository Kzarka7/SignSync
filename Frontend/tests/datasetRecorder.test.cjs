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
    useCallback(callback, deps) {
      const index = cursor++, previous = slots[index]
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) slots[index] = { deps, callback }
      return slots[index].callback
    },
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
        storageError: error => 'Could not save: ' + error.message,
        getSequences: async (scope = 'training') => saved.filter(s => !!s.evaluation === (scope === 'evaluation')),
        saveSequence: async sample => { if (storageOptions.failSave) throw new Error('Storage full'); saved.push(sample) },
        clearSequences: async (scope, ids) => { for (let i = saved.length - 1; i >= 0; i--) if (!!saved[i].evaluation === (scope === 'evaluation') && (!ids || ids.includes(saved[i].id))) saved.splice(i, 1) },
        deleteSequence: async () => {},
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
    key(code, tagName = 'BODY', extra = {}) { const event = { code, target: { tagName }, defaultPrevented:false, preventDefault() { this.defaultPrevented=true }, ...extra }; listeners.get('keydown')(event); return event },
  }
}

test('sign collection offers all 55 vocabulary labels, including the 35 expansion labels', async () => {
  const recorder = recorderHarness({ signsOnly: true }).render()
  assert.equal(recorder.knownLabels.length, 55)
  assert.equal(new Set(recorder.knownLabels).size, 55)
  for (const label of ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
    'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
    'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
    'GOOD_MORNING', 'GOOD_AFTERNOON', 'GOOD_EVENING', 'YESTERDAY', 'TOMORROW', 'TODAY']) {
    assert.equal(recorder.knownLabels.includes(label), true, label)
  }
})

const collection = { kind: 'idle', protocol: 'idle-v1',
  hands: 'both', posture: 'near_waist', palmOrientation: 'natural', targetDurationMs: 3000 }

test('evaluation tabs show and clear only their own captures', async () => {
  const idle = { scope: 'evaluation', evaluationGroup: 'idle', durationLimitMs: 3000,
    evaluation: { protocol: 'boundary-pilot-v1', taskId: 'no-sign-extra-idle_left_near_waist', participantId: 'P1', sessionId: 'one', notes: '' } }
  const pilot = { scope: 'evaluation', evaluationGroup: 'pilot',
    evaluation: { ...idle.evaluation, taskId: 'HELP-normal' } }
  const h = recorderHarness(idle)
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render()
  recorder.setCountdownSeconds(0)
  recorder.setSelectedLabel('IDLE')
  recorder = h.render()
  recorder.startRecording()
  h.frame(0); h.frame(2800)
  h.fire(3000); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.render().sequences.length, 1)
  recorder = h.render(pilot)
  assert.equal(recorder.sequences.length, 0)
  recorder.setSelectedLabel('HELP')
  recorder = h.render(pilot)
  recorder.startRecording()
  h.frame(0); h.frame(4000)
  await recorder.stopRecording()
  assert.equal(h.render(pilot).sequences.length, 1)
  recorder = h.render(idle)
  assert.equal(recorder.sequences[0].label, 'IDLE')
  await recorder.clearAll()
  assert.equal(h.render(idle).sequences.length, 0)
  assert.equal(h.render(pilot).sequences[0].label, 'HELP')
})

test('idle auto-stop saves once with context captured at start and clears its timer', async () => {
  const h = recorderHarness({ collection, durationLimitMs: 3000 })
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render()
  recorder.setSelectedLabel('IDLE')
  recorder.setCountdownSeconds(0)
  recorder = h.render()
  recorder.startRecording()
  recorder.startRecording() // repeated trigger must not clear the current buffer
  h.frame(100); h.frame(1500); h.frame(2900)
  h.render({ collection: { ...collection, hands: 'left' }, durationLimitMs: 3000 })
  h.fire(3000); await new Promise(resolve => setImmediate(resolve))
  await recorder.stopRecording()
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].label, 'IDLE')
  assert.equal(h.saved[0].collection.hands, 'both')
  assert.equal(Object.hasOwn(h.saved[0].collection, 'participantId'), false)
  assert.equal(h.saved[0].frames.length, 3)
  assert.equal(h.timers.size, 0)
})

test('a disallowed recording stays blocked even through the Space shortcut', async () => {
  const h = recorderHarness({ recordingAllowed: false, durationLimitMs: 3000 })
  const recorder = h.render()
  recorder.startRecording()
  h.key('Space')
  assert.equal(h.timers.size, 0)
  assert.equal(h.saved.length, 0)
})

test('disabled live-recording shortcuts leave Space available for processing playback', async () => {
  const options={hotkeysEnabled:false,durationLimitMs:3000}
  const h=recorderHarness(options);h.render();await new Promise(resolve=>setImmediate(resolve))
  h.render().setCountdownSeconds(0);h.render()
  assert.equal(h.key('Space').defaultPrevented,false)
  assert.equal(h.key('Space','BODY',{shiftKey:true}).defaultPrevented,false)
  assert.equal(h.timers.size,0)
  h.render({...options,hotkeysEnabled:true})
  assert.equal(h.key('Space').defaultPrevented,true)
  assert.ok(h.timers.size>0,'live-camera recording still starts with Space')
})

test('idle records and auto-saves without choosing a variation', async () => {
  const h = recorderHarness({ collection: { kind: 'idle', protocol: 'idle-v1', targetDurationMs: 3000 }, durationLimitMs: 3000 })
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render()
  recorder.setSelectedLabel('IDLE')
  recorder.setCountdownSeconds(0)
  recorder = h.render()
  recorder.startRecording()
  h.frame(0); h.frame(2800)
  h.fire(3000); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].label, 'IDLE')
  assert.equal(Object.hasOwn(h.saved[0].collection, 'hands'), false)
  assert.equal(Object.hasOwn(h.saved[0].collection, 'posture'), false)
})

test('countdown starts the duration timer only after preparation and Escape discards from a button', async () => {
  const h = recorderHarness({ collection, durationLimitMs: 3000 })
  h.render(); await new Promise(resolve => setImmediate(resolve))
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

test('evaluation records a long no-sign clip with missing hands and freezes task metadata at start', async () => {
  const evaluation = { protocol: 'boundary-pilot-v1', taskId: 'no-sign-1', participantId: 'P4', sessionId: 'pilot', notes: 'quiet rest' }
  const h = recorderHarness({ scope: 'evaluation', evaluation })
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render()
  recorder.setSelectedLabel('NO_SIGN')
  recorder.setCountdownSeconds(0)
  recorder = h.render()
  recorder.startRecording()
  h.frame(0); h.frame(15000); h.frame(30000)
  assert.equal(h.saved.length, 0)
  evaluation.taskId = 'interruption-1'
  await recorder.stopRecording()
  assert.equal(h.saved.length, 1)
  assert.equal(h.saved[0].durationMs, 30000)
  assert.equal(h.saved[0].evaluation.taskId, 'no-sign-1')
  assert.equal(h.saved[0].label, 'NO_SIGN')
  assert.equal(h.timers.size, 0)
})

test('short idle recordings are rejected while ordinary sign recordings keep manual duration', async () => {
  for (const idle of [true, false]) {
    const h = recorderHarness(idle ? { collection, durationLimitMs: 3000 } : {})
    h.render(); await new Promise(resolve => setImmediate(resolve))
    h.render().setCountdownSeconds(0)
    const recorder = h.render()
    recorder.startRecording()
    h.frame(0); h.frame(500)
    await recorder.stopRecording()
    assert.equal(h.saved.length, idle ? 0 : 1)
    if (idle) assert.match(h.render().saveError, /at least 2 seconds/)
    assert.equal(h.timers.size, 0)
  }
})


test('training freezes batch metadata and scopes captures and clearing to batch/category', async () => {
  const metadata = { protocol: 'separate-training-v1', batchId: 'batch-a', participantId: 'P1', category: 'rest', taskId: 'rest-left', taskTitle: 'Left hand' }
  const options = { training: metadata, trainingBatchId: 'batch-a', trainingCategory: 'rest', durationLimitMs: 3000 }
  const h = recorderHarness(options)
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render()
  recorder.setSelectedLabel('REST'); recorder.setCountdownSeconds(0)
  recorder = h.render(); recorder.startRecording()
  for (let t = 0; t <= 2800; t += 350) h.frame(t)
  h.render({ ...options, training: { ...metadata, participantId: 'P2' } })
  h.fire(3000); await new Promise(resolve => setImmediate(resolve))
  recorder = h.render()
  assert.equal(recorder.lastSavedSequence.training.participantId, 'P1')
  assert.equal(recorder.sequences.length, 1)
  const other = { trainingBatchId: 'batch-b', trainingCategory: 'sign', training: { ...metadata, batchId: 'batch-b', participantId: 'P2', category: 'sign', taskId: 'HELP-v1-normal' } }
  recorder = h.render(other); assert.equal(recorder.sequences.length, 0)
  recorder.setSelectedLabel('HELP'); recorder = h.render(other); recorder.startRecording()
  for (let t = 0; t <= 1000; t += 100) h.frame(t)
  await recorder.stopRecording()
  recorder = h.render(other); assert.equal(recorder.sequences.length, 1)
  await recorder.clearAll()
  assert.equal(h.render(other).sequences.length, 0)
  assert.equal(h.render(options).sequences.length, 1)
})

test('short, discarded and failed training captures do not emit a successful-save event', async () => {
  const options = { trainingBatchId: 'batch-a', trainingCategory: 'rest', durationLimitMs: 3000,
    training: { protocol: 'separate-training-v1', batchId: 'batch-a', participantId: 'P1', category: 'rest', taskId: 'rest-left', taskTitle: 'Left hand' } }
  const storageOptions = {}
  const h = recorderHarness(options, storageOptions)
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render(); recorder.setSelectedLabel('REST'); recorder.setCountdownSeconds(0)
  recorder = h.render(); recorder.startRecording(); h.frame(0); h.frame(500); await recorder.stopRecording()
  assert.equal(h.render().lastSavedSequence, null)
  recorder = h.render(); recorder.startRecording()
  for (let t = 0; t <= 2800; t += 350) h.frame(t)
  recorder.discardRecording()
  assert.equal(h.render().lastSavedSequence, null)
  storageOptions.failSave = true
  recorder = h.render(); recorder.startRecording()
  for (let t = 0; t <= 2800; t += 350) h.frame(t)
  h.fire(3000); await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.render().lastSavedSequence, null)
  assert.equal(h.saved.length, 0)
  assert.match(h.render().saveError, /Could not save/)
})


test('optional durations auto-save all categories and unselected duration waits for manual stop', async () => {
  for (const category of ['sign', 'rest', 'idle_movement']) {
    for (const durationLimitMs of [undefined, 1000, 3000, 5000]) {
      const training = category === 'sign' ? undefined : {
        protocol: 'separate-training-v1', category, taskId: `${category}-task`, taskTitle: category,
      }
      const h = recorderHarness({ training, durationLimitMs })
      h.render(); await new Promise(resolve => setImmediate(resolve))
      let recorder = h.render()
      recorder.setCountdownSeconds(0)
      recorder = h.render(); recorder.startRecording()
      const captureDuration = durationLimitMs ?? 6000
      for (let t = 0; t < captureDuration; t += 100) h.frame(t)
      assert.equal(h.saved.length, 0)
      if (durationLimitMs) { h.fire(durationLimitMs); await new Promise(resolve => setImmediate(resolve)) }
      else {
        assert.equal([...h.timers.values()].some(timer => [1000, 3000, 5000].includes(timer.ms)), false)
        await recorder.stopRecording()
      }
      assert.equal(h.saved.length, 1, `${category}: ${durationLimitMs ?? 'manual'}`)
      assert.equal(h.render().saveError, null)
      assert.equal(h.timers.size, 0)
    }
  }
})

test('restored sign collector records manually and keeps non-sign samples out of its list and clear action', async () => {
  const rest = { trainingCategory: 'rest', durationLimitMs: 3000, training: { protocol: 'separate-training-v1', category: 'rest', taskId: 'rest-left', taskTitle: 'Resting' } }
  const h = recorderHarness(rest)
  h.render(); await new Promise(resolve => setImmediate(resolve))
  let recorder = h.render(); recorder.setSelectedLabel('REST'); recorder.setCountdownSeconds(0)
  recorder = h.render(); recorder.startRecording()
  for (let t=0; t<=2800; t+=350) h.frame(t)
  h.fire(3000); await new Promise(resolve => setImmediate(resolve))
  const sign = { signsOnly: true }
  recorder = h.render(sign)
  assert.equal(recorder.sequences.length, 0)
  assert.equal(recorder.knownLabels.includes('REST'), false)
  recorder.setSelectedLabel('THANK_YOU')
  recorder = h.render(sign); recorder.startRecording()
  h.frame(0); h.frame(1500); h.frame(3500)
  assert.equal([...h.timers.values()].some(timer => timer.ms === 3000), false)
  await recorder.stopRecording()
  recorder = h.render(sign)
  assert.equal(recorder.sequences.length, 1)
  assert.equal(recorder.sequences[0].label, 'THANK_YOU')
  await recorder.clearAll()
  assert.equal(h.render(sign).sequences.length, 0)
  assert.equal(h.render(rest).sequences.length, 1)
})
