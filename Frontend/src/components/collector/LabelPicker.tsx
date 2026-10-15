import { memo } from 'react'
import Dropdown from '../shared/Dropdown'

interface LabelPickerProps {
  knownLabels: string[]
  selectedLabel: string
  onSelectLabel: (label: string) => void
  disabled?: boolean
}

// Wrapped in memo: knownLabels/selectedLabel/onSelectLabel/disabled are
// all reference-stable during a recording session (see useDatasetRecorder's
// useMemo around knownLabels), so this only needs to re-render when one of
// them actually changes - not on every detection tick a sibling causes.
function LabelPicker({ knownLabels, selectedLabel, onSelectLabel, disabled }: LabelPickerProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <label className="text-sm font-semibold text-text-2">Sign label</label>

      <Dropdown
        options={knownLabels.map((label) => ({ label, value: label }))}
        value={selectedLabel}
        onChange={onSelectLabel}
        className={disabled ? 'pointer-events-none opacity-60 w-full' : 'w-full'}
      />
    </div>
  )
}

export default memo(LabelPicker)
