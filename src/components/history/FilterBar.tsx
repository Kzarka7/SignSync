import { useState } from 'react'
import Dropdown from '../shared/Dropdown'

export default function FilterBar() {
  const [location, setLocation] = useState('all')
  const [range, setRange] = useState('30d')

  return (
    <div className="flex gap-2.5 mb-4.5 flex-wrap" style={{ marginBottom: '18px' }}>
      <input
        type="text"
        placeholder="Search by phrase, location, or date"
        className="flex-1 min-w-[200px] text-sm border border-border rounded-lg px-3 py-2.5"
      />
      <Dropdown
        value={location}
        onChange={setLocation}
        options={[
          { label: 'All locations', value: 'all' },
          { label: 'Hospital', value: 'hospital' },
          { label: 'School', value: 'school' },
          { label: 'Government office', value: 'government' },
        ]}
      />
      <Dropdown
        value={range}
        onChange={setRange}
        options={[
          { label: 'Last 30 days', value: '30d' },
          { label: 'Last 7 days', value: '7d' },
          { label: 'All time', value: 'all' },
        ]}
      />
    </div>
  )
}