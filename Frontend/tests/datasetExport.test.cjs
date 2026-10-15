const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const JSZip = require('jszip')

function loadExport(globals = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file)
    const exports = {}
    cache.set(file, exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    vm.runInNewContext(code, {
      exports, Blob, console, ...globals,
      require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name),
    }, { filename: file })
    return exports
  }
  return load(path.resolve(__dirname, '../src/services/dataset/datasetExport.ts'))
}

test('repeated ZIP preparation preserves every sample, actual labels, and raw frames', async () => {
  const { buildPerSampleZipExport } = loadExport()
  const sequences = ['HELLO', 'THANK_YOU'].map((label, index) => ({
    id: `sample-${index}`, label, createdAt: '2026-10-13T00:00:00Z', durationMs: 0,
    frames: [{ timestamp: 123, raw: { timestamp: 123, pose: null, leftHand: null, rightHand: null } }],
  }))
  for (let attempt = 0; attempt < 3; attempt++) {
    const { blob, filename } = await buildPerSampleZipExport(sequences)
    assert.match(filename, /2x.*samples\.zip$/)
    const archive = await JSZip.loadAsync(await blob.arrayBuffer())
    const files = Object.keys(archive.files)
    assert.equal(files.length, 2)
    for (let i = 0; i < sequences.length; i++) {
      const payload = JSON.parse(await archive.files[files[i]].async('string'))
      assert.equal(payload.sequenceCount, 1)
      assert.equal(payload.sequences[0].id, sequences[i].id)
      assert.equal(payload.sequences[0].label, sequences[i].label)
      assert.deepEqual(payload.sequences[0].frames[0].raw, sequences[i].frames[0].raw)
      assert.equal(payload.sequences[0].frames[0].features.length, 164)
      assert.ok(files[i].startsWith(sequences[i].label.toLowerCase().replaceAll('_', '-')))
    }
  }
})

test('repeated downloads use fresh URLs and release them only after the browser can consume them', () => {
  const clicked = [], revoked = [], pending = []
  let count = 0
  const { triggerDownload } = loadExport({
    URL: {
      createObjectURL: () => `blob:test-${++count}`,
      revokeObjectURL: url => revoked.push(url),
    },
    document: {
      body: { appendChild: link => { link.attached = true } },
      createElement: () => ({
        click() { assert.equal(this.attached, true); clicked.push(this.href) },
        remove() { this.attached = false },
      }),
    },
    setTimeout: (callback, delay) => { assert.ok(delay > 0); pending.push(callback) },
  })
  const blob = new Blob(['archive'])
  for (let i = 0; i < 3; i++) triggerDownload(blob, 'samples.zip')
  assert.deepEqual(clicked, ['blob:test-1', 'blob:test-2', 'blob:test-3'])
  assert.equal(revoked.length, 0)
  pending.forEach(callback => callback())
  assert.deepEqual(revoked, clicked)
})

test('idle participant and condition metadata survive JSON and per-sample ZIP exports', async () => {
  const { buildDatasetExport, buildPerSampleZipExport } = loadExport()
  const collection = { kind: 'idle', protocol: 'idle-v1', participantId: 'participant_02',
    sessionId: 'idle-session-01', hands: 'left', posture: 'near_waist',
    palmOrientation: 'natural', targetDurationMs: 3000 }
  const sample = { id: 'idle-sample', label: 'IDLE_LEFT_NEAR_WAIST',
    createdAt: '2026-10-14T00:00:00Z', durationMs: 2900, frames: [], collection }
  const json = JSON.parse(JSON.stringify(buildDatasetExport([sample])))
  assert.deepEqual(json.sequences[0].collection, collection)
  assert.deepEqual(json.labels, ['IDLE'])
  assert.equal(json.sequences[0].label, 'IDLE')
  const { blob } = await buildPerSampleZipExport([sample])
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const payload = JSON.parse(await Object.values(zip.files)[0].async('string'))
  assert.deepEqual(payload.sequences[0].collection, collection)
  assert.equal(payload.sequences[0].label, 'IDLE')
  assert.match(Object.keys(zip.files)[0], /^idle-01-/)
  const legacy = buildDatasetExport([{ ...sample, label: 'HELLO', collection: undefined }])
  assert.equal(Object.hasOwn(legacy.sequences[0], 'collection'), false)
})

test('mixed old and new idle variations export as a single class with separate metadata', () => {
  const { buildDatasetExport } = loadExport()
  const base = { createdAt: '2026-10-15T00:00:00Z', durationMs: 2900, frames: [] }
  const data = JSON.parse(JSON.stringify(buildDatasetExport([
    { ...base, id: 'left', label: 'IDLE_LEFT_NEAR_WAIST' },
    { ...base, id: 'both', label: 'IDLE', collection: { kind: 'idle', protocol: 'idle-v1',
      hands: 'both', posture: 'in_front', palmOrientation: 'natural', targetDurationMs: 3000 } },
    { ...base, id: 'sign', label: 'THANK_YOU' },
  ])))
  assert.deepEqual(data.labels, ['IDLE', 'THANK_YOU'])
  assert.equal(data.sequences[0].collection.hands, 'left')
  assert.equal(data.sequences[1].collection.hands, 'both')
  assert.equal(data.sequences[2].label, 'THANK_YOU')
})
