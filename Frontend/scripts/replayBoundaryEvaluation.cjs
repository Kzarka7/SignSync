const fs = require('node:fs')
const path = require('node:path')
const JSZip = require('jszip')
const load = require('./loadTypeScript.cjs')
const { createSignBoundaryDetector, BOUNDARY_DEFAULTS } = load(path.resolve(__dirname, '../src/services/landmarks/signBoundaryDetector.ts'))

async function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Usage: node scripts/replayBoundaryEvaluation.cjs <evaluation.json|zip> <new-report.json>')
  if (fs.existsSync(output)) throw new Error('Report already exists; choose a new output filename.')
  const bytes = fs.readFileSync(input)
  const text = input.toLowerCase().endsWith('.zip')
    ? await (await JSZip.loadAsync(bytes)).file('evaluation.json')?.async('string') : bytes.toString('utf8')
  if (!text) throw new Error('Archive must contain evaluation.json')
  const data = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (data.format !== 'signsync-boundary-evaluation' || data.version !== 1 || data.purpose !== 'evaluation-only' || !Array.isArray(data.recordings)) {
    throw new Error('Expected an evaluation-only boundary export; training datasets are not accepted.')
  }
  const recordings = [], ids = new Set()
  for (const recording of data.recordings) {
    if (ids.has(recording.id) || !recording.id || recording.evaluation?.protocol !== 'boundary-pilot-v1' || !Array.isArray(recording.frames) || !recording.frames.length) {
      throw new Error('Invalid or duplicate evaluation recording: ' + recording.id)
    }
    ids.add(recording.id)
    const detector = createSignBoundaryDetector(), events = []
    const origin = recording.frames[0].timestamp
    let previousTime = null, wasMonitoring = false, monitoringDurationMs = 0
    for (const frame of recording.frames) {
      if (!frame.raw || frame.timestamp !== frame.raw.timestamp) throw new Error('Frame/raw timestamp mismatch: ' + recording.id)
      events.push(...detector.push(frame.raw))
      const monitoring = detector.phase !== 'calibrating'
      const elapsed = previousTime === null ? 0 : frame.timestamp - previousTime
      if (wasMonitoring && monitoring && elapsed <= BOUNDARY_DEFAULTS.maxGapMs) monitoringDurationMs += elapsed
      previousTime = frame.timestamp; wasMonitoring = monitoring
    }
    events.push(...detector.finish())
    const relative = events.map(e => ({ ...e, startMs: e.startMs - origin, endMs: e.endMs - origin, decisionMs: e.decisionMs - origin }))
    const segments = relative.filter(e => e.type === 'segment')
    // The task provides an intended count, not human-verified boundaries.
    const task = recording.evaluation.taskId
    const expectedCount = task.startsWith('no-sign-') ? 0 : task.startsWith('interruption-') ? null : task.endsWith('-repeat') ? 2 : 1
    recordings.push({ id: recording.id, evaluation: recording.evaluation, intendedLabel: recording.label,
      durationMs: recording.frames.at(-1).timestamp - origin, frameCount: recording.frames.length,
      monitoringDurationMs,
      expectedCount, detectedCount: segments.length, events: relative,
      countMatchesTask: expectedCount === null || monitoringDurationMs === 0 ? null : expectedCount === segments.length })
  }
  const noSign = recordings.filter(r => r.expectedCount === 0)
  const noSignMinutes = noSign.reduce((sum, r) => sum + r.monitoringDurationMs, 0) / 60000
  const falseCaptures = noSign.reduce((sum, r) => sum + r.detectedCount, 0)
  const report = { format: 'signsync-boundary-replay', version: 1, settings: BOUNDARY_DEFAULTS,
    limitations: [
      'Unvalidated motion/rest heuristic; no learned IDLE detector or sign classification.',
      'Task counts do not establish timing accuracy: two incorrect segments can still match the intended count.',
      'Mark starts/ends from matching video before measuring cutoffs, splits, merges or end-detection delay.',
      'No model accuracy, live-readiness or unseen-signer performance is established by this report.',
      'No-sign time excludes calibration and unmonitored intervals; inspect monitoringDurationMs before interpreting count matches.',
    ],
    summary: { recordingCount: recordings.length, noSignMinutes, falseCaptures,
      falseCapturesPerMinute: noSignMinutes > 0 ? falseCaptures / noSignMinutes : null,
      tasksWithMatchingCounts: recordings.filter(r => r.countMatchesTask === true).length,
      tasksWithExpectedCounts: recordings.filter(r => r.countMatchesTask !== null).length,
      recordingsNeverReady: recordings.filter(r => r.monitoringDurationMs === 0).length }, recordings }
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(report.summary, null, 2))
  console.log('Saved offline replay:', path.resolve(output))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
