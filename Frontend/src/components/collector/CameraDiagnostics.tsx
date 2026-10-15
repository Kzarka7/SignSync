import { useState } from 'react'
import type { CameraFeedState } from '../../hooks/useCameraFeed'
import type { DetectionInputWidth } from '../../services/detectionInput'

export default function CameraDiagnostics({ feed, detectionInputWidth, onChangeInputWidth, locked }: {
  feed: CameraFeedState
  detectionInputWidth: DetectionInputWidth
  onChangeInputWidth: (width: DetectionInputWidth) => void
  locked: boolean
}) {
  const [report, setReport] = useState('')
  const [message, setMessage] = useState('')
  async function copyReport() {
    const text = feed.getPerformanceReport()
    setReport(text)
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Copied. Paste this report into the chat.')
    } catch {
      setMessage('Copy the report from the text box below.')
    }
  }
  return <details className="text-sm text-text-2">
    <summary className="cursor-pointer">Camera diagnostics</summary>
    <label className="block mt-2">
      Detection image
      <select
        className="block w-full mt-1 rounded-lg border border-border bg-white p-2"
        value={detectionInputWidth ?? 'original'}
        disabled={locked}
        onChange={event => {
          onChangeInputWidth(event.target.value === '640' ? 640 : null)
          setReport('')
          setMessage('Record a new sample to measure this setting.')
        }}
      >
        <option value="640">640 × 360 — speed trial</option>
        <option value="original">Original capture size — baseline</option>
      </select>
    </label>
    <p className="my-2">Capture stays at 1280 × 720. Compare FPS and finger tracking with both settings before collecting more samples.</p>
    <p className="my-2">Record for 10–15 seconds, then stop and copy the report. Each recording starts a fresh measurement.</p>
    <button type="button" onClick={copyReport} className="border border-border rounded-lg px-3 py-2">Copy performance report</button>
    {message && <p role="status" className="my-2">{message}</p>}
    {report && <textarea aria-label="Camera performance report" readOnly value={report} rows={10} className="w-full mt-2 p-2 border border-border rounded-lg font-mono text-xs" />}
  </details>
}
