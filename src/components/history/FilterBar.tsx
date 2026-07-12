import Dropdown from '../shared/Dropdown'

export type LocationFilter = 'all' | 'hospital' | 'school' | 'government'
export type RangeFilter = 'all' | '7d' | '30d'

interface FilterBarProps {
  search: string
  onSearchChange: (value: string) => void
  location: LocationFilter
  onLocationChange: (value: LocationFilter) => void
  range: RangeFilter
  onRangeChange: (value: RangeFilter) => void
}

// Fully controlled - HistoryPage owns the actual filter state and computes
// the filtered session list, so this component stays presentation-only.
export default function FilterBar({
  search,
  onSearchChange,
  location,
  onLocationChange,
  range,
  onRangeChange,
}: FilterBarProps) {
  return (
    <div className="flex gap-2.5 mb-4.5 flex-wrap" style={{ marginBottom: '18px' }}>
      <input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search by session title or location"
        className="flex-1 min-w-[200px] text-sm border border-border rounded-lg px-3 py-2.5"
      />
      <Dropdown
        value={location}
        onChange={(v) => onLocationChange(v as LocationFilter)}
        options={[
          { label: 'All locations', value: 'all' },
          { label: 'Hospital', value: 'hospital' },
          { label: 'School', value: 'school' },
          { label: 'Government office', value: 'government' },
        ]}
      />
      <Dropdown
        value={range}
        onChange={(v) => onRangeChange(v as RangeFilter)}
        options={[
          { label: 'Last 7 days', value: '7d' },
          { label: 'Last 30 days', value: '30d' },
          { label: 'All time', value: 'all' },
        ]}
      />
    </div>
  )
}
