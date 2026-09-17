import { Search } from 'lucide-react'
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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Search sessions</span>
        <Search size={19} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by session title or location"
          className="min-h-11 w-full rounded-lg border border-border bg-white py-2.5 pl-10 pr-3 text-base font-medium text-ink placeholder:text-text-3 focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal"
        />
      </label>
      <Dropdown
        value={location}
        onChange={(v) => onLocationChange(v as LocationFilter)}
        options={[
          { label: 'All locations', value: 'all' },
          { label: 'Hospital', value: 'hospital' },
          { label: 'School', value: 'school' },
          { label: 'Government office', value: 'government' },
        ]}
        className="min-w-[180px]"
      />
      <Dropdown
        value={range}
        onChange={(v) => onRangeChange(v as RangeFilter)}
        options={[
          { label: 'All time', value: 'all' },
          { label: 'Last 30 days', value: '30d' },
          { label: 'Last 7 days', value: '7d' },
        ]}
        className="min-w-[150px]"
      />
    </div>
  )
}
