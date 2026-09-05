import { LabeledSequence } from '../../types/dataset'

// Single seam between localStorage and the rest of the app, same pattern
// as sessionHistoryStorage.ts - only this file needs to change once a real
// backend exists for the dataset.
const STORAGE_KEY = 'daloy:dataset-sequences'

function readAll(): LabeledSequence[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LabeledSequence[]) : []
  } catch {
    // Corrupt JSON, or localStorage unavailable (private/incognito mode,
    // or disabled) - treat as "no samples" rather than throwing.
    return []
  }
}

function writeAll(sequences: LabeledSequence[]): void {
  // Deliberately not swallowed here (unlike sessionHistoryStorage) - a
  // failed write most likely means the quota is full, and losing a
  // just-recorded sample silently would be a bad surprise. Callers decide
  // how to surface it (see useDatasetRecorder's saveError).
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sequences))
}

// Newest first, by createdAt.
export function getSequences(): LabeledSequence[] {
  return readAll().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
}

export function saveSequence(sequence: LabeledSequence): void {
  const all = readAll()
  all.push(sequence)
  writeAll(all)
}

export function deleteSequence(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id))
}

export function clearSequences(): void {
  writeAll([])
}
