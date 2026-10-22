import { LabeledSequence } from '../../types/dataset'
import { normalizeIdleSequence } from './idleCollection'

// Single seam between localStorage and the rest of the app, same pattern
// as sessionHistoryStorage.ts - only this file needs to change once a real
// backend exists for the dataset.
const STORAGE_KEY = 'daloy:dataset-sequences'

export type DatasetScope = 'training' | 'evaluation'
const storageKey = (scope: DatasetScope) => scope === 'evaluation' ? 'signsync:boundary-evaluation-v1' : STORAGE_KEY

function readAll(scope: DatasetScope): LabeledSequence[] {
  try {
    const raw = localStorage.getItem(storageKey(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LabeledSequence[]) : []
  } catch {
    // Corrupt JSON, or localStorage unavailable (private/incognito mode,
    // or disabled) - treat as "no samples" rather than throwing.
    return []
  }
}

function writeAll(sequences: LabeledSequence[], scope: DatasetScope): void {
  // Deliberately not swallowed here (unlike sessionHistoryStorage) - a
  // failed write most likely means the quota is full, and losing a
  // just-recorded sample silently would be a bad surprise. Callers decide
  // how to surface it (see useDatasetRecorder's saveError).
  localStorage.setItem(storageKey(scope), JSON.stringify(sequences))
}

// Preserve save order so the first saved take stays at the top, matching batch review.
export function getSequences(scope: DatasetScope = 'training'): LabeledSequence[] {
  return readAll(scope).map(normalizeIdleSequence)
}

export function saveSequence(sequence: LabeledSequence, scope: DatasetScope = 'training'): void {
  if ((scope === 'evaluation') !== !!sequence.evaluation) throw new Error('Recording purpose does not match storage.')
  if (sequence.training && (scope !== 'training' || !sequence.training.taskId
    || (sequence.training.participantId !== undefined && !sequence.training.participantId.trim())
    || (sequence.training.batchId !== undefined && !sequence.training.batchId.trim()))) {
    throw new Error('Invalid training metadata or recording purpose.')
  }
  const all = readAll(scope)
  if (sequence.videoImport && all.some(s => s.videoImport?.fingerprint === sequence.videoImport?.fingerprint)) {
    throw new Error('This source video has already been saved.')
  }
  all.push(sequence)
  writeAll(all, scope)
}

export function deleteSequence(id: string, scope: DatasetScope = 'training'): void {
  writeAll(readAll(scope).filter((s) => s.id !== id), scope)
}

export function clearSequences(scope: DatasetScope = 'training', ids?: string[]): void {
  const selected = ids && new Set(ids)
  writeAll(selected ? readAll(scope).filter(s => !selected.has(s.id)) : [], scope)
}
