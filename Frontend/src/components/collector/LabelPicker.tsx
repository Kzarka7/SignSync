import { memo, useState } from 'react'
import { Plus } from 'lucide-react'
import Dropdown from '../shared/Dropdown'
import Button from '../shared/Button'

interface LabelPickerProps {
  knownLabels: string[]
  selectedLabel: string
  onSelectLabel: (label: string) => void
  disabled?: boolean
}

// Normalizes free-typed labels to the same SHOUTING_SNAKE_CASE convention
// as the seed examples (HELLO, THANK_YOU) so the exported dataset doesn't
// end up with e.g. "Thank you" and "THANK_YOU" as two different classes.
function normalizeLabel(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '_')
}

// Wrapped in memo: knownLabels/selectedLabel/onSelectLabel/disabled are
// all reference-stable during a recording session (see useDatasetRecorder's
// useMemo around knownLabels), so this only needs to re-render when one of
// them actually changes - not on every detection tick a sibling causes.
function LabelPicker({ knownLabels, selectedLabel, onSelectLabel, disabled }: LabelPickerProps) {
  const [customInput, setCustomInput] = useState('')

  function handleAddCustom() {
    const normalized = normalizeLabel(customInput)
    if (!normalized) return
    onSelectLabel(normalized)
    setCustomInput('')
  }

  return (
    <div className="flex flex-col gap-2.5">
      <label className="text-sm font-semibold text-text-2">Sign label</label>

      <Dropdown
        options={knownLabels.map((label) => ({ label, value: label }))}
        value={selectedLabel}
        onChange={onSelectLabel}
        className={disabled ? 'pointer-events-none opacity-60 w-full' : 'w-full'}
      />

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
          placeholder="Add a new label (e.g. GOODBYE)"
          disabled={disabled}
          className="flex-1 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-signal disabled:opacity-60"
        />
        <Button type="button" size="sm" onClick={handleAddCustom} disabled={disabled || !customInput.trim()}>
          <Plus size={14} /> Add
        </Button>
      </div>
    </div>
  )
}

export default memo(LabelPicker)