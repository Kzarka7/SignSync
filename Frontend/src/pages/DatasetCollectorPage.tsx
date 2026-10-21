import { useState } from 'react'
import BoundarySampleCollector from '../components/collector/BoundarySampleCollector'
import SignSampleCollector from '../components/collector/SignSampleCollector'

export default function DatasetCollectorPage() {
  const [view, setView] = useState<'sign' | 'boundary'>('sign')
  const [locked, setLocked] = useState(false)
  return <>
    <div className="grid grid-cols-2 sm:flex gap-1 mb-4 border-b border-border" role="group" aria-label="Collection purpose">
      {(['sign', 'boundary'] as const).map(value => <button key={value} disabled={locked}
        aria-pressed={view === value} onClick={() => setView(value)}
        className={`border-b-2 px-3 py-3 text-sm font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal ${view === value ? 'border-signal text-signal' : 'border-transparent text-text-2 hover:text-ink'}`}>
        {value === 'sign' ? 'Sign Language Collector' : 'Rest and Idle Collector'}
      </button>)}
    </div>
    {view === 'sign' ? <SignSampleCollector onLocked={setLocked} /> : <BoundarySampleCollector onLocked={setLocked} />}
  </>
}
