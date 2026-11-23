const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

const code = ts.transpileModule(fs.readFileSync('src/services/landmarks/videoReplay.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function fixture(useVideoFrames, onFrame, metadataDuration = 2) {
  const exports = {}
  const frames = new Map()
  const observed = [], progress = [], seeks = []
  const controller = new AbortController()
  let nextId = 0, landmarkerClosed = 0, revoked = 0, start
  const playing = new Promise(resolve => { start = resolve })
  const schedule = callback => {
    frames.set(++nextId, callback)
    return nextId
  }
  const cancel = id => { frames.delete(id) }

  class MockVideo extends EventTarget {
    duration = metadataDuration
    videoWidth = 320
    videoHeight = 240
    readyState = 2
    seconds = 0
    paused = true
    ended = false
    playbackRate = 2
    defaultPlaybackRate = 2
    playCount = 0
    source = ''
    set src(value) {
      this.source = value
      queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')))
    }
    get currentTime() { return this.seconds }
    set currentTime(value) { seeks.push(value); this.seconds = value }
    async play() { this.paused = false; this.playCount++; start() }
    pause() { this.paused = true }
    getAttribute(name) { return name === 'src' ? this.source : null }
    removeAttribute() { this.source = '' }
    load() {}
  }
  const video = new MockVideo()
  if (useVideoFrames) {
    video.requestVideoFrameCallback = schedule
    video.cancelVideoFrameCallback = cancel
  }

  const createLandmarker = async (_, onDelegate) => {
    onDelegate('CPU')
    return { detectForVideo() {}, close() { landmarkerClosed++ } }
  }
  vm.runInNewContext(code, {
    exports, performance, setTimeout, clearTimeout,
    requestAnimationFrame: schedule, cancelAnimationFrame: cancel,
    URL: { createObjectURL: () => 'blob:video', revokeObjectURL() { revoked++ } },
    require(name) {
      if (name.endsWith('/videoDuration')) return { readVideoDuration: async () => 2 }
      if (name === '@mediapipe/tasks-vision') return { FilesetResolver: { forVisionTasks: async () => ({}) } }
      if (name.endsWith('/visionRuntime')) return {
        createHandLandmarker: createLandmarker, createPoseLandmarker: createLandmarker,
        buildFrameSample: timestamp => ({ timestamp }),
      }
      if (name.endsWith('/videoHandAssignment')) return { createStreamingHandAssignment: () => sample => sample }
      throw Error(name)
    },
  })

  return {
    video, observed, progress, seeks, playing, controller,
    get landmarkerClosed() { return landmarkerClosed },
    get revoked() { return revoked },
    get callbacks() { return frames.size },
    async replay() {
      return exports.replayVideo({ name: 'clip.webm' }, {
        video, signal: controller.signal,
        async onFrame(sample) { observed.push(sample.timestamp); await onFrame?.(sample) },
        onProgress: (_, stage) => progress.push(stage),
        onPreview() {},
      })
    },
    present(seconds) {
      video.seconds = seconds
      const [id, callback] = [...frames.entries()][0]
      frames.delete(id)
      callback(0, { mediaTime: seconds })
    },
    end() { video.ended = true; video.pause(); video.dispatchEvent(new Event('ended')) },
  }
}

test('native playback stays at 1x without seeks while recognition drains in order', async () => {
  let release
  const blocked = new Promise(resolve => { release = resolve })
  const f = fixture(true, () => blocked)
  let finished = false
  const pending = f.replay().then(report => { finished = true; return report })
  await f.playing
  assert.equal(f.video.playbackRate, 1)
  assert.equal(f.video.defaultPlaybackRate, 1)
  f.present(.033)
  f.present(.067)
  f.present(.1)
  f.present(.133)
  assert.equal(f.video.paused, false)
  assert.deepEqual(f.seeks, [])
  f.end()
  assert.equal(f.progress.at(-1), 'Finishing recognition')
  assert.equal(f.callbacks, 0)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  assert.deepEqual(f.observed, [0])
  release()
  const report = await pending
  assert.deepEqual(f.observed, [0, 67, 100])
  assert.equal(report.playbackRate, 1)
  assert.equal(report.processedFrames, 3)
  assert.equal(f.landmarkerClosed, 2)
  assert.equal(f.revoked, 1)
})

test('animation-frame fallback samples playback time and Stop cancels playback', async () => {
  const f = fixture(false)
  const pending = f.replay()
  await f.playing
  f.present(.05)
  f.present(.05)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(f.observed, [0, 50])
  f.controller.abort(Error('Cancelled by test'))
  await assert.rejects(pending, /Cancelled by test/)
  assert.equal(f.video.paused, true)
  assert.equal(f.callbacks, 0)
  assert.equal(f.landmarkerClosed, 2)
  assert.equal(f.revoked, 1)
})


test('WebM with infinite metadata duration replays using packet duration', async () => {
  const f = fixture(true, undefined, Infinity)
  const pending = f.replay()
  await f.playing
  assert.ok(f.progress.includes('Reading video duration'))
  f.present(.1)
  f.end()
  const report = await pending
  assert.equal(report.durationSeconds, 2)
  assert.equal(f.revoked, 1)
})

test('genuinely overlong video is rejected before tracking and releases its URL', async () => {
  const f = fixture(true, undefined, 121)
  await assert.rejects(f.replay(), /at most 120 seconds/)
  assert.equal(f.video.playCount, 0)
  assert.equal(f.landmarkerClosed, 0)
  assert.equal(f.revoked, 1)
})



