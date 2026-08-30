// Shared with LiveTopbar's running session clock, so any place that shows
// a "time into the session" (the topbar counter, a message's timestamp,
// etc.) renders it identically instead of drifting into different formats.
export function formatElapsedTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds))
  const h = String(Math.floor(safeSeconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, '0')
  const s = String(safeSeconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

// How many whole seconds elapsed between a session's start time and some
// later point (e.g. when a message was created) - both as epoch ms.
// Clamped at 0 so a message that raced slightly ahead of the recorded
// start (clock jitter) never renders as negative.
export function elapsedSecondsBetween(startMs: number, atMs: number): number {
  return Math.max(0, Math.floor((atMs - startMs) / 1000))
}
