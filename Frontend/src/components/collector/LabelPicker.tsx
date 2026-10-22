import { memo, useId, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { findSignLabels } from '../../services/dataset/signLabelSearch'

interface LabelPickerProps {
  knownLabels: string[]
  selectedLabel: string
  onSelectLabel: (label: string) => void
  disabled?: boolean
}

function LabelPicker({ knownLabels, selectedLabel, onSelectLabel, disabled }: LabelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const originalSelection = useRef(selectedLabel)
  const id = useId()
  const matches = query?.trim() ? findSignLabels(knownLabels, query) : knownLabels
  const expanded = open && !disabled
  const activeIndex = active >= 0 && active < matches.length ? active : -1

  const showOptions = () => {
    if (disabled || open) return
    originalSelection.current = selectedLabel
    setQuery(null)
    setActive(-1)
    setOpen(true)
  }
  const choose = (label: string) => {
    if (disabled) return
    onSelectLabel(label)
    originalSelection.current = label
    setQuery(null)
    setOpen(false)
    setActive(-1)
  }
  const move = (index: number) => {
    setActive(index)
    input.current?.parentElement?.querySelectorAll('[role="option"]')[index]?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={`${id}-input`} className="text-sm font-semibold text-text-2">Sign label</label>
      <div className="relative" onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setOpen(false)
        setQuery(null)
        setActive(-1)
      }}>
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={`${id}-options`}
          aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          value={query ?? selectedLabel}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search or select a sign…"
          className={`min-h-11 w-full rounded-lg border border-border bg-white py-2.5 pl-3 pr-11 text-base font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60 ${disabled ? 'cursor-not-allowed' : expanded ? 'cursor-text' : 'cursor-pointer'}`}
          onFocus={showOptions}
          onClick={showOptions}
          onChange={event => {
            if (disabled) return
            if (!open) originalSelection.current = selectedLabel
            const value = event.currentTarget.value
            setQuery(value)
            setOpen(true)
            setActive(-1)
            const results = findSignLabels(knownLabels, value)
            onSelectLabel(results.length === 1 ? results[0] : '')
          }}
          onKeyDown={event => {
            if (disabled || event.nativeEvent.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              showOptions()
              const next = event.key === 'ArrowDown'
                ? (activeIndex + 1) % Math.max(1, matches.length)
                : activeIndex <= 0 ? matches.length - 1 : activeIndex - 1
              move(next)
            } else if (event.key === 'Enter' && expanded) {
              event.preventDefault()
              const result = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined)
              if (result) choose(result)
            } else if (event.key === 'Escape' && expanded) {
              event.preventDefault()
              onSelectLabel(originalSelection.current)
              setOpen(false)
              setQuery(null)
              setActive(-1)
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? 'Close sign options' : 'Show sign options'}
          disabled={disabled}
          className="absolute right-0 top-0 flex min-h-11 w-11 cursor-pointer items-center justify-center text-text-2 disabled:cursor-not-allowed disabled:opacity-60"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            if (disabled) return
            if (expanded) { setOpen(false); setQuery(null); setActive(-1) }
            else { showOptions(); input.current?.focus() }
          }}
        >
          <ChevronDown size={18} className={expanded ? 'rotate-180' : ''} />
        </button>
        {expanded && <div id={`${id}-options`} role="listbox" aria-label="Matching signs"
          className="absolute left-0 right-0 z-20 mt-2 max-h-[220px] overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-lg custom-scrollbar">
          {matches.length ? matches.map((label, index) => <button
            id={`${id}-option-${index}`}
            key={label}
            type="button"
            role="option"
            aria-selected={label === selectedLabel}
            tabIndex={-1}
            className={`flex min-h-10 w-full cursor-pointer items-center justify-between rounded-md my-1 px-3 py-2.5 text-left text-base font-semibold ${label === selectedLabel ? 'text-signal hover:bg-signal-light' : 'text-ink hover:bg-sky'} ${index === activeIndex || label === selectedLabel ? 'bg-signal-light' : ''}`}
            onMouseDown={event => event.preventDefault()}
            onClick={() => choose(label)}
          >
            {label}
            {label === selectedLabel && <Check size={14} className="text-signal" aria-hidden="true" />}
          </button>) : <p role="status" className="px-3 py-3 text-sm text-text-2">No matching signs.</p>}
        </div>}
      </div>
    </div>
  )
}

export default memo(LabelPicker)
