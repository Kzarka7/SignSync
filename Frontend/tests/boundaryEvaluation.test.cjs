const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const JSZip = require('jszip')
function loader() {
  const cache = new Map(), storage = new Map()
  function load(file) {
    file = path.resolve(__dirname, '../src/services/dataset', file)
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText
    vm.runInNewContext(code, { exports, Blob, console, crypto: require('node:crypto').webcrypto,
      localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
      require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name),
    })
    return exports
  }
  return load
}
const sample = { id: 'test', label: 'HELP', createdAt: '2026-10-16', durationMs: 30000,
  frames: [{ timestamp: 1, raw: { timestamp: 1, pose: null, leftHand: null, rightHand: null } }] }
const evaluation = { ...sample, evaluation: { protocol: 'boundary-pilot-v1', taskId: 'HELP-normal', participantId: 'P4', sessionId: 'pilot', notes: 'video.mp4' } }
test('evaluation save, delete and clear cannot modify training recordings', () => {
  const load = loader(), storage = load('datasetStorage.ts')
  storage.saveSequence(sample)
  storage.saveSequence(evaluation, 'evaluation')
  assert.equal(storage.getSequences().length, 1)
  assert.equal(storage.getSequences('evaluation').length, 1)
  storage.deleteSequence('test', 'evaluation')
  assert.equal(storage.getSequences().length, 1)
  storage.saveSequence(evaluation, 'evaluation')
  storage.clearSequences('evaluation')
  assert.equal(storage.getSequences('evaluation').length, 0)
  assert.equal(storage.getSequences().length, 1)
  assert.throws(() => storage.saveSequence(evaluation))
  assert.throws(() => storage.saveSequence(sample, 'evaluation'))
})
test('clearing selected idle recordings preserves pilot and training samples', () => {
  const storage = loader()('datasetStorage.ts')
  storage.saveSequence(sample)
  storage.saveSequence(evaluation, 'evaluation')
  storage.saveSequence({ ...evaluation, id: 'idle', label: 'IDLE',
    evaluation: { ...evaluation.evaluation, taskId: 'no-sign-extra-idle_left_beside_torso' } }, 'evaluation')
  storage.clearSequences('evaluation', ['idle'])
  assert.equal(storage.getSequences('evaluation').length, 1)
  assert.equal(storage.getSequences('evaluation')[0].id, evaluation.id)
  assert.equal(storage.getSequences().length, 1)
})
test('40-task protocol and evaluation ZIP preserve metadata and reject training mixing', async () => {
  const load = loader(), api = load('boundaryEvaluation.ts')
  assert.equal(api.BOUNDARY_TASKS.length, 40)
  assert.equal(new Set(api.BOUNDARY_TASKS.map(t => t.id)).size, 40)
  assert.equal(api.BOUNDARY_TASKS.filter(t => t.label === 'NO_SIGN').length, 4)
  assert.equal(api.BOUNDARY_TASKS.filter(t => t.label === 'INTERRUPTION').length, 4)
  assert.throws(() => api.buildEvaluationExport([sample]))
  assert.throws(() => load('datasetExport.ts').buildDatasetExport([evaluation]))
  const { blob, filename } = await api.buildEvaluationZip([evaluation])
  assert.match(filename, /^signsync-boundary-evaluation-/)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const payload = JSON.parse(await zip.file('evaluation.json').async('string'))
  assert.equal(payload.sequences, undefined)
  assert.equal(payload.purpose, 'evaluation-only')
  assert.deepEqual(payload.recordings[0], evaluation)
})

test('extra idle takes preserve posture tasks without inflating required progress', async () => {
  const api = loader()('boundaryEvaluation.ts')
  assert.equal(api.EXTRA_IDLE_TASKS.length, 10)
  assert.equal(new Set(api.EXTRA_IDLE_TASKS.map(t => t.id)).size, 10)
  assert.ok(api.EXTRA_IDLE_TASKS.every(t => t.label === 'NO_SIGN' && t.id.startsWith('no-sign-extra-')))
  const extra = { ...evaluation, id: 'extra-1', label: 'NO_SIGN',
    evaluation: { ...evaluation.evaluation, taskId: api.EXTRA_IDLE_TASKS[0].id } }
  const recordings = [evaluation, { ...evaluation, id: 'repeat-required' }, extra,
    { ...extra, id: 'extra-2' },
    { ...extra, id: 'other-session', evaluation: { ...extra.evaluation, sessionId: 'other' } },
    { ...evaluation, id: 'other-person', evaluation: { ...evaluation.evaluation, participantId: 'P1', taskId: 'HOW-normal' } }]
  const progress = api.getBoundaryProgress(recordings, ' P4 ', ' pilot ')
  assert.equal(progress.completedTasks, 1)
  assert.equal(progress.extraIdleRecordings, 2)
  const { blob } = await api.buildEvaluationZip(recordings)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const payload = JSON.parse(await zip.file('evaluation.json').async('string'))
  assert.equal(payload.tasks.length, 40)
  assert.equal(payload.optionalTasks.length, 10)
  assert.deepEqual(payload.recordings[2], extra)
})

test('advance skips recorded pilot tasks, wraps to gaps, and stays when complete', () => {
  const api = loader()('boundaryEvaluation.ts')
  const tasks = api.BOUNDARY_TASKS
  const take = id => ({ ...evaluation, evaluation: { ...evaluation.evaluation, taskId: id } })
  assert.equal(api.getNextBoundaryTask(tasks[0].id, [take(tasks[0].id), take(tasks[1].id)]), tasks[2].id)
  assert.equal(api.getNextBoundaryTask(tasks.at(-1).id, [take(tasks.at(-1).id)]), tasks[0].id)
  assert.equal(api.getNextBoundaryTask(tasks[0].id, tasks.map(t => take(t.id))), tasks[0].id)
  assert.equal(api.getNextBoundaryTask('unknown', []), 'unknown')
})

test('idle advance waits for three saves and skips completed variations', () => {
  const api = loader()('boundaryEvaluation.ts')
  const tasks = api.EXTRA_IDLE_TASKS
  const takes = (id, count) => Array.from({ length: count }, () => ({ ...evaluation, evaluation: { ...evaluation.evaluation, taskId: id } }))
  assert.equal(api.getNextBoundaryTask(tasks[0].id, takes(tasks[0].id, 2)), tasks[0].id)
  assert.equal(api.getNextBoundaryTask(tasks[0].id, [...takes(tasks[0].id, 3), ...takes(tasks[1].id, 4)]), tasks[2].id)
  assert.equal(api.getNextBoundaryTask(tasks.at(-1).id, takes(tasks.at(-1).id, 3)), tasks[0].id)
  assert.equal(api.getNextBoundaryTask(tasks[0].id, tasks.flatMap(t => takes(t.id, 3))), tasks[0].id)
})

test('idle checklist matches the 9/9/12 plan and counts saved variations independently', () => {
  const api = loader()('boundaryEvaluation.ts')
  for (const [hands, target] of [['left', 9], ['right', 9], ['both', 12]]) {
    const tasks = api.EXTRA_IDLE_TASKS.filter(t => t.hands === hands)
    assert.equal(tasks.reduce((sum, t) => sum + t.target, 0), target)
    assert.equal(tasks.some(t => t.posture === 'beside_torso'), hands === 'both')
    assert.equal(tasks.filter(t => t.posture === 'in_front_open_palm').length, 1)
  }
  const first = api.EXTRA_IDLE_TASKS[0]
  const takes = Array.from({ length: 4 }, (_, i) => ({ ...evaluation, id: `take-${i}`,
    evaluation: { ...evaluation.evaluation, taskId: first.id, participantId: '', sessionId: '', notes: '' } }))
  const checklist = api.getIdleChecklist(takes)
  assert.equal(checklist[0].count, 4)
  assert.equal(checklist[1].count, 0)
  assert.equal(checklist.reduce((sum, t) => sum + Math.min(t.count, t.target), 0), 3)
  assert.equal(api.getIdleChecklist(takes.slice(0, 2))[0].count, 2)
  assert.equal(api.getEvaluationTaskTitle(first.id), first.title)
  assert.match(api.getEvaluationTaskTitle('no-sign-extra-idle_left_beside_torso'), /Beside torso/)
  assert.equal(api.getBoundaryProgress([evaluation]).completedTasks, 1)
})


test('separate training plans retain batch identity, variants and three distinct categories', async () => {
  const load = loader(), api = load('trainingCollection.ts'), storage = load('datasetStorage.ts')
  assert.throws(() => api.createTrainingBatch(' ', {}), /participant/)
  const batch = api.createTrainingBatch(' P1 ', { WHICH: 2 })
  const second = api.createTrainingBatch('P2', {})
  assert.equal(batch.participantId, 'P1')
  assert.notEqual(batch.id, second.id)
  assert.equal(api.getTrainingBatches().length, 2)
  const signs = api.getTrainingTasks(batch, 'sign')
  assert.equal(signs.length, 63)
  assert.equal(signs.filter(t => t.label === 'WHICH').length, 6)
  const rest = api.getTrainingTasks(batch, 'rest')
  const idle = api.getTrainingTasks(batch, 'idle_movement')
  assert.equal(rest.reduce((sum, t) => sum + t.target, 0), 30)
  assert.equal(idle.reduce((sum, t) => sum + (t.target ?? 0), 0), 21)
  assert.equal(idle.some(t => t.id === 'idle-movement-glasses'), false)
  const general = idle.find(t => t.id === 'idle-movement-general')
  assert.equal(general.target, null)
  assert.ok(rest.every(t => t.label === 'REST' && t.durationMs === 3000))
  assert.ok(idle.every(t => t.label === 'IDLE_MOVEMENT' && t.durationMs === 5000))
  const task = signs.find(t => t.label === 'WHICH' && t.variantId === 'v2')
  const clip = { ...sample, training: { protocol: 'separate-training-v1', batchId: batch.id, participantId: batch.participantId,
    category: task.category, taskId: task.id, taskTitle: task.title, variantId: task.variantId, pace: task.pace } }
  storage.saveSequence(clip)
  assert.equal(storage.getSequences()[0].training.batchId, batch.id)
  assert.throws(() => storage.saveSequence({ ...clip, evaluation: evaluation.evaluation }, 'evaluation'))
  assert.throws(() => storage.saveSequence({ ...clip, training: { ...clip.training, participantId: '' } }))
  const exported = load('datasetExport.ts').buildDatasetExport([clip])
  assert.deepEqual(JSON.parse(JSON.stringify(exported.sequences[0].training)), clip.training)
  const archive = await load('datasetExport.ts').buildPerSampleZipExport([clip])
  assert.ok(archive.filename.includes('p1-sign-'))
  const zip = await JSZip.loadAsync(await archive.blob.arrayBuffer())
  const file = Object.values(zip.files).find(f => f.name.endsWith('.json'))
  assert.deepEqual(JSON.parse(await file.async('string')).sequences[0].training, clip.training)
  const restTakes = Array.from({length: 3}, (_, i) => ({ ...clip, id: 'rest-' + i, training: { ...clip.training, category: 'rest', taskId: rest[0].id } }))
  assert.equal(api.nextTrainingTask(rest, restTakes.slice(0, 2), batch.id, rest[0].id), rest[0].id)
  assert.equal(api.nextTrainingTask(rest, restTakes, batch.id, rest[0].id), rest[1].id)
  assert.equal(api.trainingTaskCount(restTakes, second.id, rest[0].id), 0)
  const generalTakes = Array.from({ length: 8 }, (_, i) => ({ ...clip, id: 'general-' + i,
    training: { ...clip.training, category: 'idle_movement', taskId: general.id } }))
  assert.equal(api.nextTrainingTask(idle, generalTakes, batch.id, general.id), general.id)
  const fixedTakes = idle.filter(t => t.target !== null).flatMap(t => Array.from({ length: 3 }, (_, i) => ({ ...clip, id: t.id + i,
    training: { ...clip.training, category: 'idle_movement', taskId: t.id } })))
  assert.equal(api.nextTrainingTask(idle, fixedTakes, batch.id, idle[0].id), idle[0].id)
  assert.equal(api.nextTrainingTask(idle, fixedTakes.filter(s => s.training.taskId !== idle[1].id), batch.id, idle[0].id), idle[1].id)
  const oldGlasses = { ...clip, id: 'legacy-glasses', training: { ...clip.training, category: 'idle_movement', taskId: 'idle-movement-glasses', taskTitle: 'Adjust glasses' } }
  storage.saveSequence(oldGlasses)
  assert.ok(storage.getSequences().some(s => s.id === oldGlasses.id))
  assert.equal(load('datasetExport.ts').buildDatasetExport([oldGlasses]).sequences[0].training.taskId, 'idle-movement-glasses')
})


test('collection without setup saves and exports category metadata and counts earlier batches', async () => {
  const load = loader(), api = load('trainingCollection.ts'), storage = load('datasetStorage.ts')
  const tasks = api.getTrainingTasks(undefined, 'rest')
  const clip = { ...sample, label: 'REST', training: { protocol: 'separate-training-v1', category: 'rest', taskId: tasks[0].id, taskTitle: tasks[0].title } }
  storage.saveSequence(clip)
  const old = { ...clip, id: 'old', training: { ...clip.training, batchId: 'old-batch', participantId: 'P1' } }
  storage.saveSequence(old)
  const takes = storage.getSequences()
  assert.equal(api.trainingTaskCount(takes, undefined, tasks[0].id), 2)
  assert.equal(api.nextTrainingTask(tasks, takes, undefined, tasks[0].id), tasks[0].id)
  storage.saveSequence({ ...clip, id: 'third' })
  assert.equal(api.nextTrainingTask(tasks, storage.getSequences(), undefined, tasks[0].id), tasks[1].id)
  const exported = load('datasetExport.ts').buildDatasetExport([clip])
  assert.equal(exported.sequences[0].training.category, 'rest')
  assert.equal(Object.hasOwn(exported.sequences[0].training, 'participantId'), false)
  assert.equal(Object.hasOwn(exported.sequences[0].training, 'batchId'), false)
  const archive = await load('datasetExport.ts').buildPerSampleZipExport([clip])
  assert.match(archive.filename, /^signsync-dataset-rest-/)
  assert.equal(archive.filename.includes('undefined'), false)
})
