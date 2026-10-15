const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function recorderHarness(options = {}) {
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
        getSequences: () => [], saveSequence: sample => saved.push(sample), clearSequences() {}, deleteSequence() {},
      }
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
  h.render().startRecording()
  assert.equal([...h.timers.values()].some(timer => timer.ms === 3000), false)
  h.fire(1000); h.fire(1000); h.fire(1000)
  h.frame(0); h.frame(2800)
  h.render()
  h.key('Escape', 'BUTTON')
  assert.equal(h.saved.length, 0)
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
