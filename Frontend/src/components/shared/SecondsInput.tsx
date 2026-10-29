import { useEffect, useState } from 'react'

export default function SecondsInput({ value, onChange, label, disabled = false, step = 1 }: {
  value: number; onChange: (seconds: number) => void; label: string; disabled?: boolean; step?: number
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return <input type="number" inputMode="decimal" aria-label={label} min={0} max={120} step={step}
    disabled={disabled} value={draft}
    className="w-10 rounded-md border border-border bg-white px-1 py-0.5 text-center text-xs text-ink disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    onChange={event => {
      setDraft(event.target.value)
      const seconds = event.target.valueAsNumber
      if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 120 && (step !== 1 || Number.isInteger(seconds))) onChange(seconds)
    }}
    onBlur={() => setDraft(String(value))} />
}
