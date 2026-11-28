const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const load = require('../scripts/loadTypeScript.cjs')

function loadWithImports(relativePath, imports) {
  const file = path.resolve(__dirname, '../src', relativePath)
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, { exports, require: name => imports(name, path.dirname(file)) }, { filename: file })
  return exports
}

const { OPTIMIZED_LIVE_CAMERA_OPTIONS, DEFAULT_LIVE_CAPTURE_PROFILE } = loadWithImports('hooks/useCameraFeed.ts', () => ({}))

function recorderHarness(options = {}, storageOptions = {}, camera = {}) {
  const slots = [], pendingEffects = [], timers = new Map(), saved = [], listeners = new Map()
  let cursor = 0, nextTimer = 0, cameraOptions, now = 0, loads = 0
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
  const feed = { enabled: true, cameraReady: true, startPerformanceProfile() {}, stopPerformanceProfile() {},
    videoRef: { current: { srcObject: camera.stream } } }
  const exports = {}
  const setTimer = (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id }
  const source = fs.readFileSync(path.resolve(__dirname, '../src/hooks/useDatasetRecorder.ts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, {
    exports, console, Date, crypto: { randomUUID: () => `sample-${saved.length}` },
    performance: { now: () => now },
    MediaStream: camera.MediaStream,
    setInterval: setTimer, clearInterval: id => timers.delete(id),
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    window: { addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) },
    require(name) {
      if (name === 'react') return react
      if (name === './useCameraFeed') return {
        OPTIMIZED_LIVE_CAMERA_OPTIONS, DEFAULT_LIVE_CAPTURE_PROFILE,
        useCameraFeed: settings => { cameraOptions = settings; return feed },
      }
      if (name.endsWith('signLabelSearch')) return load(path.resolve(__dirname, '../src/services/dataset/signLabelSearch.ts'))
      if (name.endsWith('idleCollection')) return load(path.resolve(__dirname, '../src/services/dataset/idleCollection.ts'))
      if (name.endsWith('cameraClip')) return load(path.resolve(__dirname, '../src/services/dataset/cameraClip.ts'), {
        Blob, MediaRecorder: camera.MediaRecorder,
      })
      if (name.endsWith('datasetStorage')) return {
        storageError: error => 'Could not save: ' + error.message,
        getSequences: async (scope = 'training') => { loads++; return saved.filter(s => !!s.evaluation === (scope === 'evaluation')) },
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
    get loads() { return loads },
    get cameraOptions() { return cameraOptions },
    render(nextOptions = options) {
      cursor = 0
      const result = exports.useDatasetRecorder(nextOptions)
      pendingEffects.splice(0).forEach(effect => effect())
      return result
    },
    setNow(timestamp) { now = timestamp },
    sample(sample) { cameraOptions.onFrame(sample) },
    frame(timestamp) { this.sample({ timestamp, pose: null, leftHand: null, rightHand: null }) },
    fire(ms) { const timer = [...timers.values()].find(timer => timer.ms === ms); assert.ok(timer); timer.callback() },
    key(code, tagName = 'BODY', extra = {}) { const event = { code, target: { tagName }, defaultPrevented:false, preventDefault() { this.defaultPrevented=true }, ...extra }; listeners.get('keydown')(event); return event },
  }
}

test('live video starts after countdown, saves the final chunk, and is discarded with the take', async () => {
  const captures = []
  class MediaStream {}
  class MediaRecorder {
    static isTypeSupported(type) { return type === 'video/webm;codecs=vp8' }
    constructor(stream, { mimeType }) {
      this.stream = stream
      this.mimeType = mimeType
      this.state = 'inactive'
      captures.push(this)
    }
    start() { this.state = 'recording'; this.onstart() }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['end'], { type: 'video/webm' }) })
        this.onstop()
      })
    }
  }
  const stream = new MediaStream()
  const h = recorderHarness({}, {}, { stream, MediaStream, MediaRecorder })
  h.render(); await new Promise(resolve => setImmediate(resolve))
  h.render().setCountdownSeconds(1)
  h.render().startRecording()
  assert.equal(captures.length, 0)
  h.fire(1000)
  assert.equal(captures[0].stream, stream)
  captures[0].ondataavailable({ data: new Blob(['start-'], { type: 'video/webm' }) })
  h.frame(100); h.frame(900)
  const save = h.render().stopRecording()
  assert.equal(h.saved.length, 0)
  await save
  assert.equal(await h.saved[0].cameraClip.text(), 'start-end')
  assert.equal(h.saved[0].cameraClip.type, 'video/webm')
  assert.equal(h.saved[0].frames.length, 2)

  h.render().startRecording()
  h.fire(1000)
  h.frame(1000); h.frame(2000)
  await h.render().discardRecording()
  assert.equal(captures[1].state, 'inactive')
  assert.equal(h.saved.length, 1)

  h.render().startRecording()
  h.fire(1000)
  h.frame(2200); h.frame(2800)
  captures[2].state = 'inactive'
  captures[2].onerror()
  await h.render().stopRecording()
  assert.equal(h.saved.length, 2)
  assert.equal(h.saved[1].cameraClip, undefined)
  assert.match(h.render().videoCaptureError, /landmarks only/)
})

test('live collector exports exact samples that produce the same wall-clock grid as Lab Camera', async () => {
  const { buildDatasetExport } = loadWithImports('services/dataset/datasetExport.ts', (name, directory) =>
    name.startsWith('.') ? load(path.resolve(directory, name + '.ts')) : require(name))
  const { toFeatureVector } = load(path.resolve(__dirname, '../src/services/landmarks/normalize.ts'))
  const { resampleLiveWindow } = load(path.resolve(__dirname, '../src/services/landmarks/windowResampling.ts'))
  const h = recorderHarness()
  h.render(); await new Promise(resolve => setImmediate(resolve))
  const recorder = h.render()
  for (const key of ['decoupleVideoFrames', 'stridePairedPose', 'reviewHandTracking']) {
    assert.equal(h.cameraOptions[key], true, key)
  }
  // Same detection schedule and threshold as Recognition Lab's live camera.
  assert.equal(h.cameraOptions.deferPose, true)
  assert.equal(h.cameraOptions.handDetectionConfidence, 0.35)
  assert.equal(h.cameraOptions.gatePreviewHands ?? false, false)
  assert.equal(h.cameraOptions.dynamicHandCapacity ?? false, false)

  const point = (x, y) => ({ x, y, z: 0, visibility: 1 })
  const pose = { nose: point(.5, .1), leftShoulder: point(.3, .3), rightShoulder: point(.7, .3),
    leftElbow: point(.3, .5), rightElbow: point(.7, .5), leftWrist: point(.4, .6), rightWrist: point(.7, .7),
    leftHip: point(.4, .9), rightHip: point(.6, .9) }
  const origin = 1000.25
  const raw = Array.from({ length: 29 }, (_, i) => ({
    timestamp: origin + 52 * i + (i % 3) * 1.25,
    pose, leftHand: i === 10 ? null : Array.from({ length: 21 }, (_, j) => point(.4 + i * .005 + j * .001, .6)),
    rightHand: i < 18 ? null : Array.from({ length: 21 }, (_, j) => point(.68 + j * .001, .7)),
  }))
  h.setNow(origin)
  recorder.startRecording()
  h.sample({ ...raw[0], timestamp: origin - .5 }) // A queued preview bitmap can arrive after Start.
  raw.forEach(sample => h.sample(sample))
  assert.equal(recorder.getRecordedFrameCount(), raw.length)
  assert.equal(h.timers.size, 0, 'the recorder must not run a progress timer')
  await recorder.stopRecording()
  h.sample({ ...raw.at(-1), timestamp: raw.at(-1).timestamp + 50 })

  const [sequence] = JSON.parse(JSON.stringify(buildDatasetExport(h.saved))).sequences
  assert.deepEqual(sequence.frames.map(frame => frame.raw), raw)
  assert.deepEqual(sequence.frames.map(frame => frame.timestamp), raw.map(frame => frame.timestamp))
  assert.equal(sequence.frameCount, raw.length)
  assert.equal(sequence.durationMs, raw.at(-1).timestamp - origin)

  const exportedGrid = resampleLiveWindow(sequence.frames.map(frame => ({
    timestamp: frame.timestamp - origin, features: frame.features, valid: frame.valid,
  })))
  const labGrid = resampleLiveWindow(raw.map(sample => {
    const relative = { ...sample, timestamp: sample.timestamp - origin }
    return { timestamp: relative.timestamp, ...toFeatureVector(relative) }
  }))
  assert.equal(exportedGrid.length, 40)
  assert.deepEqual(structuredClone(exportedGrid), structuredClone(labGrid))
})

test('sign collection offers vocabulary, indexing, possessive, and fingerspelling labels', () => {
  const recorder = recorderHarness({ signsOnly: true }).render()
  // 113 earlier labels + the 26-sign 2026-11 batch.
  assert.equal(recorder.knownLabels.length, 139)
  assert.equal(new Set(recorder.knownLabels).size, recorder.knownLabels.length)
  assert.equal(recorder.knownLabels.includes('SLEEP'), false)
  assert.equal(recorder.knownLabels.includes('BATHROOM'), false)
  for (const label of ['DONT_KNOW', 'HARD_OF_HEARING', 'WANT', 'NEED', 'HAVE', 'CANT', 'NUMBER']) {
    assert.equal(recorder.knownLabels.includes(label), true, label)
  }
  for (const label of ['MAN', 'ENTER', 'EXIT', 'DIRECTION', 'NEAR', 'FAR']) {
    assert.equal(recorder.knownLabels.includes(label), false, label)
  }
  for (const label of ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
    'FAST', 'SLOW',
    'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
    'GOOD_MORNING', 'GOOD_AFTERNOON', 'GOOD_EVENING', 'YESTERDAY', 'TOMORROW', 'TODAY',
    'IX-1', 'IX-2', 'IX-3', 'IX-1pl', 'IX-2pl', 'IX-3pl',
    'POSS-1', 'POSS-2', 'POSS-3', 'POSS-1pl', 'POSS-2pl', 'POSS-3pl',
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) {
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

function delayedStartRecorder(captures) {
  return class MediaRecorder {
    static isTypeSupported(type) { return type === 'video/webm;codecs=vp8' }
    constructor(stream, { videoBitsPerSecond }) { this.state = 'inactive'; this.videoBitsPerSecond = videoBitsPerSecond; captures.push(this) }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => { this.ondataavailable({ data: new Blob(['clip'], { type: 'video/webm' }) }); this.onstop() })
    }
  }
}

test('live takes keep frames and start the duration limit only after the clip encoder starts', async () => {
  const captures = []
  class MediaStream {}
  const h = recorderHarness({ durationLimitMs: 2000 }, {}, { stream: new MediaStream(), MediaStream, MediaRecorder: delayedStartRecorder(captures) })
  h.render(); await new Promise(resolve => setImmediate(resolve))
  h.setNow(100)
  h.render().startRecording()
  assert.equal(captures[0].videoBitsPerSecond, 2500000)
  assert.ok(![...h.timers.values()].some(timer => timer.ms === 2000), 'duration waits for the encoder')
  h.frame(150) // during encoder start-up
  assert.equal(h.render().getRecordedFrameCount(), 0)
  h.setNow(400)
  captures[0].onstart()
  assert.ok(![...h.timers.values()].some(timer => timer.ms === 750), 'start fallback is cleared')
  h.frame(450); h.frame(500)
  assert.equal(h.render().getRecordedFrameCount(), 2)
  h.fire(2000)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.saved.length, 1)
  assert.deepEqual([...h.saved[0].frames].map(frame => frame.timestamp), [450, 500])
})

test('live takes start keeping frames after the fallback wait if the encoder never reports start', async () => {
  const captures = []
  class MediaStream {}
  const h = recorderHarness({}, {}, { stream: new MediaStream(), MediaStream, MediaRecorder: delayedStartRecorder(captures) })
  h.render(); await new Promise(resolve => setImmediate(resolve))
  h.render().startRecording()
  h.setNow(750)
  h.fire(750)
  h.frame(800); h.frame(900)
  assert.equal(h.render().getRecordedFrameCount(), 2)
  captures[0].onstart() // late start event must not restart the take
  h.frame(950)
  assert.equal(h.render().getRecordedFrameCount(), 3)
  await h.render().discardRecording()
  // A stale fallback from the discarded take must not affect the next one.
  h.render().startRecording()
  h.frame(1000)
  assert.equal(h.render().getRecordedFrameCount(), 0)
})

test('collector uses Recognition Lab camera defaults and can switch to 640x360', async () => {
  const h = recorderHarness()
  h.render(); await new Promise(resolve => setImmediate(resolve))
  // Recognition Lab defaults (RecognitionLabPage useCameraFeed call).
  assert.equal(h.cameraOptions.captureProfile, '720p')
  assert.equal(h.cameraOptions.detectionInputWidth, 640)
  assert.equal(h.cameraOptions.landmarkMode ?? 'both', 'both')
  assert.equal(h.cameraOptions.showPoseLandmarks ?? true, true)
  assert.equal(h.cameraOptions.lowLightAssist ?? true, true)
  assert.equal(h.cameraOptions.handDelegate ?? 'GPU', 'GPU')
  assert.equal(h.cameraOptions.trackLiveTiming, true)
  assert.equal(h.cameraOptions.trackOverlayPaint, true)
  h.render().setCaptureProfile('fast')
  h.render()
  assert.equal(h.cameraOptions.captureProfile, 'fast')
})

test('saving and deleting update the sample list without reloading every stored sample', async () => {
  const h = recorderHarness()
  h.render(); await new Promise(resolve => setImmediate(resolve))
  const initialLoads = h.loads
  h.render().startRecording()
  h.frame(100); h.frame(900)
  await h.render().stopRecording()
  assert.equal(h.loads, initialLoads)
  const [sample] = h.render().allSequences
  assert.equal(sample.id, h.saved[0].id)
  assert.equal(h.render().lastSavedSequence.id, sample.id)
  await h.render().removeSequence(sample.id)
  assert.equal(h.loads, initialLoads)
  assert.equal(h.render().allSequences.length, 0)
})

test('live clips prefer H.264 and fall back to VP8; the phone-style recorder keeps VP8', () => {
  const made = []
  const recorderFor = supported => class MediaRecorder {
    static isTypeSupported(type) { return supported.includes(type) }
    constructor(stream, { mimeType, videoBitsPerSecond }) { this.mimeType = mimeType; this.videoBitsPerSecond = videoBitsPerSecond; this.state = 'inactive'; made.push(this) }
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive' }
  }
  const clipModule = supported => load(path.resolve(__dirname, '../src/services/dataset/cameraClip.ts'), { Blob, File, MediaRecorder: recorderFor(supported) })
  const all = ['video/mp4;codecs=avc1.42E01F', 'video/webm;codecs=h264', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm']

  clipModule(all).startCameraClip({})
  assert.equal(made.at(-1).mimeType, 'video/mp4;codecs=avc1.42E01F')
  assert.equal(made.at(-1).videoBitsPerSecond, 2500000)
  clipModule(all.slice(1)).startCameraClip({})
  assert.equal(made.at(-1).mimeType, 'video/webm;codecs=h264')
  clipModule(['video/webm;codecs=vp8', 'video/webm']).startCameraClip({})
  assert.equal(made.at(-1).mimeType, 'video/webm;codecs=vp8')
  clipModule(all).createCameraMediaRecorder({})
  assert.equal(made.at(-1).mimeType, 'video/webm;codecs=vp8')
  assert.equal(made.at(-1).videoBitsPerSecond, 8000000)

  const { cameraClipFile } = clipModule(all)
  assert.equal(cameraClipFile(new Blob(['v'], { type: 'video/mp4;codecs=avc1.42E01F' }), 'a').name, 'a.mp4')
  assert.equal(cameraClipFile(new Blob(['v'], { type: 'video/x-matroska;codecs=avc1' }), 'b').name, 'b.mkv')
  assert.equal(cameraClipFile(new Blob(['v'], { type: 'video/webm;codecs=vp8' }), 'c').name, 'c.webm')
})
