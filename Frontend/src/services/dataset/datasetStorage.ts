import type { LabeledSequence } from '../../types/dataset'
import { normalizeIdleSequence } from './idleCollection'

export type DatasetScope = 'training' | 'evaluation'
const storageKey = (scope: DatasetScope) => scope === 'evaluation' ? 'signsync:boundary-evaluation-v1' : 'daloy:dataset-sequences'
const stores: DatasetScope[] = ['training', 'evaluation']
type Row = { order?: number; id: string; fingerprint?: string; sample: LabeledSequence }
let connection: Promise<IDBDatabase> | undefined
let migration: Promise<void> | undefined

export function storageError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if ((error as { name?: string })?.name === 'QuotaExceededError') return 'Browser storage is full. Export saved samples, then delete samples or free device space and retry.'
  return `Could not access sample storage: ${detail}. Keep this page open and retry; unsaved videos remain in the queue.`
}
function openDatabase(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is unavailable in this browser')); return }
    let blocked = false
    const request = indexedDB.open('signsync-dataset', 1)
    request.onupgradeneeded = () => {
      for (const scope of stores) {
        const store = request.result.createObjectStore(scope, { keyPath: 'order', autoIncrement: true })
        store.createIndex('id', 'id', { unique: true })
        // Legacy duplicates are preserved during migration; new saves check this index atomically.
        store.createIndex('fingerprint', 'fingerprint')
      }
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => { blocked = true; reject(new Error('Close other SignSync tabs so the sample database can open')) }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => { db.close(); connection = undefined }
      resolve(db)
    }
  }).catch(error => { connection = undefined; throw error })
  return connection
}
function transaction<T>(db: IDBDatabase, scope: DatasetScope, mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(scope, mode)
    let value: T, failure: Error | null = null
    tx.oncomplete = () => resolve(value)
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Sample transaction was cancelled'))
    tx.onerror = () => { /* onabort reports failures, never request success */ }
    const fail = (error: Error) => { failure = error; tx.abort() }
    try { run(tx.objectStore(scope), result => { value = result }, fail) }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
  })
}
async function migrate(db: IDBDatabase) {
  const snapshots = stores.map(scope => ({ scope, key: storageKey(scope), raw: localStorage.getItem(storageKey(scope)) }))
    .filter((entry): entry is { scope: DatasetScope; key: string; raw: string } => entry.raw !== null)
  for (const { scope, raw } of snapshots) {
    try {
      const samples: LabeledSequence[] = JSON.parse(raw)
      if (!Array.isArray(samples) || samples.some(s => !s || typeof s.id !== 'string' || !s.id || !Array.isArray(s.frames))) throw new Error('Legacy samples are malformed')
      if (new Set(samples.map(s => s.id)).size !== samples.length) throw new Error('Legacy samples contain conflicting IDs')
      await transaction<void>(db, scope, 'readwrite', (store, done, fail) => {
        for (const sample of samples) {
          const existing = store.index('id').get(sample.id)
          existing.onsuccess = () => {
            if (existing.result) {
              if (JSON.stringify((existing.result as Row).sample) !== JSON.stringify(sample)) fail(new Error(`Existing sample ${sample.id} differs from its legacy copy`))
            } else {
              const added = store.add({ id: sample.id, fingerprint: sample.videoImport?.fingerprint, sample } satisfies Row)
              added.onsuccess = () => {
                const check = store.get(added.result)
                check.onsuccess = () => {
                  if (JSON.stringify((check.result as Row)?.sample) !== JSON.stringify(sample)) fail(new Error(`Verification failed for ${sample.id}`))
                }
              }
            }
          }
        }
        done()
      })
    } catch (error) {
      throw new Error(`Could not migrate ${scope} samples. Original localStorage data has been preserved. ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Verify both scopes before removing any legacy data. Cleanup failure is safe to retry.
  try {
    for (const { key, raw } of snapshots) {
      if (localStorage.getItem(key) !== raw) throw new Error('Legacy data changed during migration; retry')
    }
    for (const { key } of snapshots) localStorage.removeItem(key)
  } catch (error) {
    throw new Error(`Migration cleanup failed. Original localStorage data has been preserved where cleanup failed; verified database copies are safe. ${error instanceof Error ? error.message : String(error)}`)
  }
}
async function ready() {
  const db = await openDatabase()
  if (!migration) migration = migrate(db).finally(() => { migration = undefined })
  await migration
  return db
}
export async function getSequences(scope: DatasetScope = 'training'): Promise<LabeledSequence[]> {
  return transaction(await ready(), scope, 'readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done((request.result as Row[]).map(row => normalizeIdleSequence(row.sample)))
  })
}
// Queue duplicate checks do not need to load every landmark frame.
export async function hasSourceFingerprint(fingerprint: string, scope: DatasetScope = 'training'): Promise<boolean> {
  return transaction(await ready(), scope, 'readonly', (store, done) => {
    const request = store.index('fingerprint').count(fingerprint)
    request.onsuccess = () => done(request.result > 0)
  })
}
export async function saveSequence(sequence: LabeledSequence, scope: DatasetScope = 'training'): Promise<void> {
  if ((scope === 'evaluation') !== !!sequence.evaluation) throw new Error('Recording purpose does not match storage.')
  if (sequence.training && (scope !== 'training' || !sequence.training.taskId
    || (sequence.training.participantId !== undefined && !sequence.training.participantId.trim())
    || (sequence.training.batchId !== undefined && !sequence.training.batchId.trim()))) throw new Error('Invalid training metadata or recording purpose.')
  return transaction(await ready(), scope, 'readwrite', (store, done, fail) => {
    const add = () => { store.add({ id: sequence.id, fingerprint: sequence.videoImport?.fingerprint, sample: sequence } satisfies Row); done() }
    if (sequence.videoImport) {
      const check = store.index('fingerprint').count(sequence.videoImport.fingerprint)
      check.onsuccess = () => check.result ? fail(new Error('This source video has already been saved.')) : add()
    } else add()
  })
}
export async function deleteSequence(id: string, scope: DatasetScope = 'training'): Promise<void> {
  return clearSequences(scope, [id])
}
export async function clearSequences(scope: DatasetScope = 'training', ids?: string[]): Promise<void> {
  return transaction(await ready(), scope, 'readwrite', (store, done) => {
    if (!ids) store.clear()
    else for (const id of ids) {
      const key = store.index('id').getKey(id)
      key.onsuccess = () => { if (key.result !== undefined) store.delete(key.result) }
    }
    done()
  })
}
