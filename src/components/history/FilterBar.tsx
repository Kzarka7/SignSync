export default function FilterBar() {
  return (
    <div className="flex gap-2.5 mb-4.5 flex-wrap" style={{ marginBottom: '18px' }}>
      <input
        type="text"
        placeholder="Search by phrase, location, or date"
        className="flex-1 min-w-[200px] text-sm border border-border rounded-lg px-3 py-2.5"
      />
      <select className="text-sm border border-border rounded-lg px-3 py-2.5 bg-white">
        <option>All locations</option>
        <option>Hospital</option>
        <option>School</option>
        <option>Government office</option>
      </select>
      <select className="text-sm border border-border rounded-lg px-3 py-2.5 bg-white">
        <option>Last 30 days</option>
        <option>Last 7 days</option>
        <option>All time</option>
      </select>
    </div>
  )
}
