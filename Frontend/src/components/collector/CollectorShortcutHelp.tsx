import { useEffect, useRef } from 'react'
import { Keyboard, X } from 'lucide-react'
import { COLLECTOR_SHORTCUTS } from '../../services/dataset/collectorShortcuts'

const groups = [
  { title: 'Playback & navigation', indices: [0, 1, 2, 7] },
  { title: 'Review & save', indices: [3, 4, 5, 6] },
  { title: 'Adjust intervals', indices: [8, 9, 10, 11, 12] },
]

function Keys({ value }: { value: string }) {
  return <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
    {value.replace(' in time field', '').split(/( \+ | \/ )/).map((part, index) => part === ' + ' || part === ' / '
      ? <span key={index} className="text-text-2 text-xs">{part.trim()}</span>
      : <kbd key={index} className="inline-flex min-w-7 h-7 items-center justify-center rounded-md border border-border bg-sky px-1.5 text-xs font-semibold font-sans shadow-sm">{part}</kbd>)}
  </span>
}

export default function CollectorShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
  }, [open])
  return <dialog ref={dialog} aria-labelledby="collector-shortcuts-title" aria-describedby="collector-shortcuts-note"
    className="fixed inset-0 !m-auto h-fit w-11/12 max-w-5xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-border bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/60"
    onCancel={event => { event.preventDefault(); onClose() }} onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div>
      <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
        <h2 id="collector-shortcuts-title" className="flex items-center gap-2 text-lg font-semibold"><Keyboard size={20} aria-hidden="true" />Collector keyboard shortcuts</h2>
        <button type="button" autoFocus onClick={onClose} aria-label="Close keyboard shortcuts"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky text-text-2 hover:bg-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"><X size={19} aria-hidden="true" /></button>
      </header>
      <div className="grid grid-cols-1 gap-7 px-5 py-6 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
        {groups.map(group => <section key={group.title} aria-label={group.title}>
          <h3 className="mb-4 text-sm font-semibold">{group.title}</h3>
          <dl className="space-y-4">{group.indices.map(index => {
            const [keys, description] = COLLECTOR_SHORTCUTS[index]
            return <div key={keys} className="flex items-center justify-between gap-3"><dt className="text-sm text-text-2">{description}</dt><dd><Keys value={keys} /></dd></div>
          })}</dl>
        </section>)}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-sky px-5 py-4 sm:px-6">
        <p id="collector-shortcuts-note" className="max-w-lg text-xs leading-relaxed text-text-2">Letter shortcuts pause while typing. Reprocess changed boundaries before reviewing or saving. Shift + C checks or unchecks eligible unsaved takes. Shift + V saves checked takes; when none remain to save, it undoes this queue’s saves and keeps the takes available.</p>
        <div className="flex items-center gap-2 text-xs text-text-2"><Keys value="?" /><span>Toggle help</span><Keys value="Esc" /><span>Close</span></div>
      </footer>
    </div>
  </dialog>
}
