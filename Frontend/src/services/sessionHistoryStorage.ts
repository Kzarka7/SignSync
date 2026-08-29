import { SavedSession } from '../types/session'

// Single seam between localStorage and the rest of the app. Once a real
// backend/database exists for session history, only this file needs to
// change - callers only ever deal in SavedSession[].
const STORAGE_KEY = 'daloy:session-history'

function readAll(): SavedSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedSession[]) : []
  } catch {
    // Corrupt JSON, or localStorage unavailable (private/incognito mode,
    // or disabled) - treat as "no history" rather than throwing.
    return []
  }
}

function writeAll(sessions: SavedSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  } catch {
    // Not fatal - the session just won't survive a refresh this time.
  }
}

// Newest first, by startedAt.
export function getSessions(): SavedSession[] {
  return readAll().sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  )
}

export function getSessionById(id: string): SavedSession | undefined {
  return readAll().find((s) => s.id === id)
}

// Upserts by id - ending (or re-saving) the same session twice updates the
// existing record in place instead of creating a duplicate.
export function saveSession(session: SavedSession): void {
  const all = readAll()
  const index = all.findIndex((s) => s.id === session.id)
  if (index >= 0) {
    all[index] = session
  } else {
    all.push(session)
  }
  writeAll(all)
}

export function deleteSession(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id))
}

export function clearSessions(): void {
  writeAll([])
}
