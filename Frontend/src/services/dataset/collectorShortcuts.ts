export const COLLECTOR_SHORTCUTS = [
  ['Space', 'Play/pause selected interval'], ['Shift + Space', 'Play/pause whole recording'],
  ['Q / E', 'Previous / next take'], ['C', 'Toggle Reviewed for current take'],
  ['Shift + C', 'Check/uncheck all eligible unsaved takes'], ['S', 'Save current reviewed take / undo save'],
  ['Shift + S', 'Save checked takes / undo queue saves'], ['T', 'Toggle interval looping'],
  ['F / G', 'Focus start / end time'], ['↑ / ↓', 'Adjust focused time by 0.05 seconds'],
  ['Shift + ↑ / ↓', 'Adjust focused time by 0.5 seconds'], ['Enter in time field', 'Reprocess interval'],
  ['Y', 'Use suggested interval'], ['?', 'Show/hide shortcut help'],
] as const

export function collectorShortcut(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'isComposing' | 'defaultPrevented' | 'target'>) {
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return null
  const target = event.target as HTMLElement | null
  if (target?.closest?.('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]')) return null
  const key = event.key.toLowerCase()
  if (key === '?') return 'help'
  if (key === ' ') return event.shiftKey ? 'play-whole' : 'play-interval'
  if (key === 'c') return event.shiftKey ? 'review-all' : 'review'
  if (key === 's') return event.shiftKey ? 'save-all' : 'save'
  if (event.shiftKey) return null
  const letters = { q: 'previous', e: 'next', t: 'loop', f: 'start', g: 'end', y: 'suggest' } as const
  return letters[key as keyof typeof letters] ?? null
}

export function adjustedIntervalTime(value: number, direction: number, shift: boolean, duration: number) {
  return Math.min(duration, Math.max(0, Math.round((value + direction * (shift ? .5 : .05)) * 1000) / 1000))
}
