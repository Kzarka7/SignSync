const { test } = require('node:test')
const assert = require('node:assert/strict')
const { IDBFactory, IDBObjectStore } = require('fake-indexeddb')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const legacyKey = 'daloy:dataset-sequences'
function fixture() {
  const indexedDB = new IDBFactory(), legacy = new Map()
  let removeFails = false
  const localStorage = { getItem: key => legacy.get(key) ?? null, removeItem: key => {
    if (removeFails) throw Error('cleanup denied')
    legacy.delete(key)
  } }
  function reload() {
    const cache = new Map()
    function load(file) {
      file = path.resolve(__dirname, '../src/services/dataset', file)
      if (cache.has(file)) return cache.get(file)
      const exports = {}; cache.set(file, exports)
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText,
        { exports, indexedDB, localStorage, Blob, console, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name) })
      return exports
    }
    return { ...load('datasetStorage.ts'), exporter: load('datasetExport.ts') }
  }
  return { reload, legacy, failCleanup: value => { removeFails = value } }
}
function sample(id = 'one') {
  return { id, label: 'HELLO', createdAt: '2026-10-23T00:00:00Z', durationMs: 1000,
    frames: [{ timestamp: 0, raw: { timestamp: 0, pose: null, leftHand: null, rightHand: null } },
      { timestamp: 1000, raw: { timestamp: 1000, pose: null, leftHand: null, rightHand: null } }],
    videoImport: { fingerprint: id, filename: id + '.mp4', trimStartMs: 250, trimEndMs: 1250,
      quality: { result: 'Review', findings: ['gap'] }, intervalReview: { choice: 'trimmed' }, review: { completeSign: true, qualityFindingsAccepted: true } } }
}
const plain = value => JSON.parse(JSON.stringify(value))
test('migration verifies complete records, preserves legacy order and separates evaluation', async () => {
  const f = fixture(), samples = [sample('z'), sample('a')]
  const evaluation = { ...sample('z'), evaluation: { taskId: 'pilot' } }
  f.legacy.set(legacyKey, JSON.stringify(samples))
  f.legacy.set('signsync:boundary-evaluation-v1', JSON.stringify([evaluation]))
  const db = f.reload()
  assert.deepEqual(plain(await db.getSequences()), samples)
  assert.deepEqual(plain(await db.getSequences('evaluation')), [evaluation])
  assert.equal(f.legacy.size, 0)
  assert.deepEqual(plain(await f.reload().getSequences()), samples)
})
test('interrupted cleanup repeats migration without duplicates or reordering', async () => {
  const f = fixture(), samples = [sample('z'), sample('a')], raw = JSON.stringify(samples)
  f.legacy.set(legacyKey, raw); f.failCleanup(true)
  await assert.rejects(f.reload().getSequences(), /Original localStorage data has been preserved/)
  assert.equal(f.legacy.get(legacyKey), raw)
  f.failCleanup(false)
  const db = f.reload()
  assert.deepEqual(plain(await db.getSequences()), samples)
  f.legacy.set(legacyKey, raw)
  assert.deepEqual(plain(await db.getSequences()), samples)
})
test('malformed or conflicting legacy records remain intact', async () => {
  for (const raw of ['bad json', '{}', JSON.stringify([sample(), sample()])]) {
    const f = fixture(); f.legacy.set(legacyKey, raw)
    await assert.rejects(f.reload().getSequences(), /preserved/)
    assert.equal(f.legacy.get(legacyKey), raw)
  }
  const f = fixture(), db = f.reload(); await db.saveSequence(sample())
  const raw = JSON.stringify([{ ...sample(), label: 'NO' }]); f.legacy.set(legacyKey, raw)
  await assert.rejects(db.getSequences(), /differs/)
  assert.equal(f.legacy.get(legacyKey), raw)
})
test('aborted migration preserves originals and rolls back every copied record', async () => {
  const f = fixture(), samples = [sample('first'), sample('second')], raw = JSON.stringify(samples)
  f.legacy.set(legacyKey, raw)
  const add = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(value) {
    const request = add.call(this, value)
    if (value.id === 'second') request.addEventListener('success', () => this.transaction.abort())
    return request
  }
  try { await assert.rejects(f.reload().getSequences(), /preserved/) }
  finally { IDBObjectStore.prototype.add = add }
  assert.equal(f.legacy.get(legacyKey), raw)
  assert.deepEqual(plain(await f.reload().getSequences()), samples)
})
test('save rejects an abort after request success and concurrent duplicate sources', async () => {
  const f = fixture(), db = f.reload(); await db.getSequences()
  const add = IDBObjectStore.prototype.add
  IDBObjectStore.prototype.add = function(value) {
    const request = add.call(this, value)
    request.addEventListener('success', () => this.transaction.abort())
    return request
  }
  try { await assert.rejects(db.saveSequence(sample())) }
  finally { IDBObjectStore.prototype.add = add }
  assert.equal((await db.getSequences()).length, 0)
  const results = await Promise.allSettled([db.saveSequence(sample()), db.saveSequence({ ...sample(), id: 'two' })])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal((await db.getSequences()).length, 1)
  assert.equal(await db.hasSourceFingerprint('one'), true)
  assert.equal(await db.hasSourceFingerprint('one', 'evaluation'), false)
})
test('deletion, selective clear, full clear and reload preserve scopes and save order', async () => {
  const f = fixture(), db = f.reload()
  for (const id of ['z', 'a', 'm']) await db.saveSequence(sample(id))
  await db.saveSequence({ ...sample('z'), evaluation: { taskId: 'pilot' } }, 'evaluation')
  await db.deleteSequence('a'); await db.deleteSequence('absent')
  await db.saveSequence(sample('a'))
  assert.deepEqual(plain((await f.reload().getSequences()).map(s => s.id)), ['z', 'm', 'a'])
  await db.clearSequences('training', ['m'])
  assert.deepEqual(plain((await db.getSequences()).map(s => s.id)), ['z', 'a'])
  await db.clearSequences()
  assert.equal((await db.getSequences()).length, 0)
  assert.equal((await db.getSequences('evaluation')).length, 1)
})
test('40 landmark samples exceeding 5 MiB persist and export as 40 unchanged JSON entries', async () => {
  const f = fixture(), db = f.reload()
  const points = Array.from({ length: 21 }, (_, i) => ({ x: i / 21, y: .123456789, z: -.01234567 }))
  const frames = Array.from({ length: 100 }, (_, i) => ({ timestamp: i * 50, raw: { timestamp: i * 50, pose: null, leftHand: points, rightHand: points } }))
  const samples = Array.from({ length: 40 }, (_, i) => ({ ...sample('batch-' + i), frames, durationMs: 4950 }))
  assert.ok(Buffer.byteLength(JSON.stringify(samples)) > 5 * 1024 * 1024)
  for (const s of samples) await db.saveSequence(s)
  const restored = await f.reload().getSequences()
  assert.deepEqual(plain(restored), samples)
  const exported = await db.exporter.buildPerSampleZipExport(restored)
  const zip = await require('jszip').loadAsync(await exported.blob.arrayBuffer())
  const entries = Object.values(zip.files).filter(f => !f.dir)
  assert.equal(entries.length, 40)
  for (const entry of entries) {
    const payload = JSON.parse(await entry.async('string')).sequences[0]
    const original = samples.find(s => s.id === payload.id)
    assert.ok(original)
    assert.deepEqual(payload.videoImport, original.videoImport)
    assert.equal(payload.frames.length, 100)
  }
})


test('a failure in evaluation migration keeps training legacy data too', async () => {
  const f = fixture(), raw = JSON.stringify([sample()])
  f.legacy.set(legacyKey, raw)
  f.legacy.set('signsync:boundary-evaluation-v1', 'broken')
  await assert.rejects(f.reload().getSequences(), /preserved/)
  assert.equal(f.legacy.get(legacyKey), raw)
  f.legacy.delete('signsync:boundary-evaluation-v1')
  assert.equal((await f.reload().getSequences()).length, 1)
})
