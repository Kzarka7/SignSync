import { useState } from 'react'
import type { CameraFeedState, CaptureProfile } from '../../hooks/useCameraFeed'

export default function CameraDiagnostics({ feed, captureProfile, onChangeCaptureProfile, locked }: {
  feed: CameraFeedState
  captureProfile: CaptureProfile
  onChangeCaptureProfile: (profile: CaptureProfile) => void
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
      Camera size
      <select
        className="block w-full mt-1 rounded-lg border border-border bg-white p-2"
        value={captureProfile}
        disabled={locked}
        onChange={event => {
          onChangeCaptureProfile(event.target.value === '720p' ? '720p' : 'fast')
          setReport('')
          setMessage('The camera restarts. Record a new sample to measure this setting.')
        }}
      >
        <option value="720p">1280 × 720 — Recognition Lab default</option>
        <option value="fast">640 × 360 — faster on some webcams</option>
      </select>
    </label>
    <p className="my-2">Detection always runs on a 640-wide image. Some webcams only deliver 15–20 fps at 720p; 640 × 360 often reaches 30 fps. Compare FPS and finger tracking with both settings.</p>
    <p className="my-2">Record for 10–15 seconds, then stop and copy the report. Each recording starts a fresh measurement.</p>
    <button type="button" onClick={copyReport} className="border border-border rounded-lg px-3 py-2">Copy performance report</button>
    {message && <p role="status" className="my-2">{message}</p>}
    {report && <textarea aria-label="Camera performance report" readOnly value={report} rows={10} className="w-full mt-2 p-2 border border-border rounded-lg font-mono text-xs" />}
  </details>
}
