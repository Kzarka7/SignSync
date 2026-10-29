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
      assert.equal(files[i], `${sequences[i].label}-${sequences[i].id}.json`)
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
  assert.equal(Object.keys(zip.files)[0], 'IDLE-idle-sample.json')
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


test('ZIP sample filenames use full IDs and actual labels without numbering', async () => {
  const { buildPerSampleZipExport } = loadExport()
  const base = { label: 'THANK_YOU', createdAt: '2026-10-22T00:00:00Z', durationMs: 0, frames: [] }
  const samples = [
    { ...base, id: 'fb71bd1b-b170-4906-b472-27d28d901f7b' },
    { ...base, id: 'fb71bd1b-b170-4906-b472-27d28d901f7c' },
  ]
  for (const ordered of [samples, [...samples].reverse()]) {
    const { blob } = await buildPerSampleZipExport(ordered, 'HELLO')
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    assert.deepEqual(Object.keys(zip.files).sort(), samples.map(s => `THANK_YOU-${s.id}.json`).sort())
    for (const name of Object.keys(zip.files)) {
      const payload = JSON.parse(await zip.file(name).async('string'))
      assert.equal(name, `${payload.sequences[0].label}-${payload.sequences[0].id}.json`)
    }
  }
  await assert.rejects(buildPerSampleZipExport([samples[0], samples[0]]), /duplicate filename/)
  await assert.rejects(buildPerSampleZipExport([{ ...base, id: '../unsafe' }]), /unsafe filename ID/)
})


test('original video ZIP contains SIGN-number videos directly at its root and preserves bytes', async () => {
  const { buildOriginalVideosZipExport } = loadExport()
  const inputs = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
  const { blob, filename } = await buildOriginalVideosZipExport(inputs.map((bytes, index) => ({
    label: index === 1 ? 'THANK_YOU' : 'HELLO',
    file: { name: 'same.mp4', arrayBuffer: async () => bytes.buffer },
  })))
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  assert.equal(filename, 'signsync-video-recordings-MIXED_SIGNS.zip')
  const names = ['HELLO-1.mp4', 'THANK_YOU-1.mp4', 'HELLO-2.mp4']
  for (const [i, bytes] of inputs.entries()) {
    assert.deepEqual(await zip.file(names[i]).async('uint8array'), bytes)
  }
  assert.equal(Object.values(zip.files).filter(file => file.dir).length, 0)
  assert.equal(Object.values(zip.files).filter(file => !file.dir).length, 3)
  const single = await buildOriginalVideosZipExport([{ label: 'Thank you', file: { name: 'clip.MOV', arrayBuffer: async () => inputs[0].buffer } }])
  assert.equal(single.filename, 'signsync-video-recordings-THANK_YOU.zip')
  const singleZip = await JSZip.loadAsync(await single.blob.arrayBuffer())
  assert.ok(singleZip.file('THANK_YOU-1.mov'))
  await assert.rejects(buildOriginalVideosZipExport([]), /No queued videos/)
})
