import { useState } from 'react'
import BoundarySampleCollector from '../components/collector/BoundarySampleCollector'
import SignSampleCollector from '../components/collector/SignSampleCollector'

export default function DatasetCollectorPage() {
  const [view, setView] = useState<'sign' | 'boundary'>('sign')
  const [locked, setLocked] = useState(false)
  return <>
    <div className="flex gap-3 mb-4 flex-wrap" role="group" aria-label="Collection purpose">
      {(['sign', 'boundary'] as const).map(value => <button key={value} disabled={locked}
        aria-pressed={view === value} onClick={() => setView(value)}
        className={`border rounded-lg p-3 disabled:opacity-50 ${view === value ? 'border-signal bg-signal-light' : 'border-border'}`}>
        {value === 'sign' ? 'Sign Language Collector' : 'Boundary Collector'}
      </button>)}
    </div>
    {view === 'sign' ? <SignSampleCollector onLocked={setLocked} /> : <BoundarySampleCollector onLocked={setLocked} />}
  </>
}
