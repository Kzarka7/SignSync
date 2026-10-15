const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/services/detectionInput.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject })

test('reduces only the detection image, preserves aspect ratio, and reuses the buffer', () => {
  const video = { videoWidth: 1280, videoHeight: 720 }
  let allocations = 0, widthWrites = 0, heightWrites = 0, width = 0, height = 0
  const draws = []
  const canvas = {
    get width() { return width }, set width(value) { width = value; widthWrites++ },
    get height() { return height }, set height(value) { height = value; heightWrites++ },
    getContext: () => ({ drawImage: (...args) => draws.push(args) }),
  }
  const prepare = exportsObject.createDetectionInput(() => { allocations++; return canvas })
  assert.equal(prepare(video, null), video)
  assert.equal(allocations, 0)
  assert.equal(prepare(video, 640), canvas)
  assert.deepEqual(draws[0], [video, 0, 0, 640, 360])
  assert.equal(prepare(video, 640), canvas)
  assert.equal(allocations, 1)
  assert.equal(widthWrites, 1)
  assert.equal(heightWrites, 1)
  assert.deepEqual(video, { videoWidth: 1280, videoHeight: 720 })
  assert.equal(prepare(video, null), video)
  prepare({ videoWidth: 1280, videoHeight: 960 }, 640)
  assert.equal(height, 480)
  const smallVideo = { videoWidth: 320, videoHeight: 180 }
  assert.equal(prepare(smallVideo, 640), smallVideo)
})

test('falls back to original video if canvas context is unavailable', () => {
  const video = { videoWidth: 1280, videoHeight: 720 }
  const prepare = exportsObject.createDetectionInput(() => ({ getContext: () => null }))
  assert.equal(prepare(video, 640), video)
})
