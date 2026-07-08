const metrics = [
  { label: 'Sessions this week', value: '12', unit: '' },
  { label: 'Minutes translated', value: '3', unit: 'h 40m' },
  { label: 'Avg. confidence', value: '94', unit: '%' },
  { label: 'Phrases logged', value: '208', unit: '' },
]

// Static for now - swap the `metrics` array for a useAsync(getUsageStats)
// call once /api/stats exists on the backend.
export default function MetricGrid() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className="bg-white border border-border rounded-xl2 px-4 py-3.5">
          <div className="text-xs text-text-2 mb-1.5">{m.label}</div>
          <div className="text-[22px] font-display font-bold">
            {m.value}
            {m.unit && <span className="text-[13px] font-medium text-text-2 ml-0.5">{m.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
