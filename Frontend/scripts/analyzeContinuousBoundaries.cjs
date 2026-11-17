// Compare application decisions using the recorded predictions, without changing
// scores, fitting thresholds, or requiring a model server. Not an accuracy test.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const load = require('./loadTypeScript.cjs')
const { createActivityPolicy, createObservationTracking, CONTINUOUS_SETTINGS, CONTINUOUS_POLICY_VERSION } = load(path.resolve(__dirname, '../src/services/landmarks/continuousRecognition.ts'))

function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw Error('Usage: node scripts/analyzeContinuousBoundaries.cjs <diagnostics.json> <new-report.json>')
  if (fs.existsSync(output)) throw Error('Output already exists; choose a new report.')
  const bytes = fs.readFileSync(input), data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  if (data.recognitionMode === 'segmented') throw Error('This analyzer compares rolling-window exports only. Gesture completion decisions require the segmented lab session and its segmentation events.')
  if (data.format !== 'signsync-continuous-diagnostics' || !Array.isArray(data.frames) || !Array.isArray(data.rows)) throw Error('Expected a diagnostic export.')
  const settings = { ...CONTINUOUS_SETTINGS, ...data.settings }
  const tracker = createObservationTracking(settings), policy = createActivityPolicy(settings)
  const byEnd = new Map(data.rows.map(row => [row.endMs, row])), decisions = [], trackingEvents = []
  let previousTracking = null
  for (const frame of data.frames) {
    const tracking = tracker.push(frame)
    policy.observeTracking(tracking)
    if (!previousTracking || previousTracking.state !== tracking.state || tracking.gapMs > 0) trackingEvents.push(tracking)
    previousTracking = tracking
    const row = byEnd.get(frame.timestamp)
    if (!row) continue
    const blocked = ['stale_result', 'inference_error', 'tracking_changed_during_inference'].includes(row.reason) ? row.reason : row.quality
    const decision = policy.update(row.prediction, row.endMs, blocked ?? undefined)
    decisions.push({ endMs: row.endMs, rawLabel: row.prediction?.label ?? null, rawScore: row.prediction?.score ?? null,
      originalReason: row.reason, originalEmit: row.emit, tracking, ...decision })
  }
  if (decisions.length !== data.rows.length) throw Error('Every prediction window must match a recorded frame timestamp.')
  const count = reason => decisions.filter(row => row.reason === reason).length
  const rearmed = policy.events.filter(event => event.type === 'rearmed')
  const report = { format: 'signsync-boundary-policy-analysis', version: 1, purpose: 'development-only',
    input: path.basename(input), inputSha256: createHash('sha256').update(bytes).digest('hex'),
    policyVersion: CONTINUOUS_POLICY_VERSION, settings,
    summary: { comparedWindows: decisions.length,
      originalWaitingForRest: data.rows.filter(row => row.reason === 'awaiting_non_sign_boundary').length,
      newWaitingForRest: count('awaiting_non_sign_boundary'), noHandsIdleWindows: count('no_hands_idle_rule'),
      originalEmittedSigns: data.rows.filter(row => row.emit).length, newEmittedSigns: decisions.filter(row => row.emit).length,
      duplicateSuppressedWindows: count('duplicate_sign_suppressed'),
      rearmsByNoHands: rearmed.filter(event => event.source === 'no-hands').length,
      rearmsByModel: rearmed.filter(event => event.source === 'model').length,
      maxObservationGapMs: Math.max(0, ...trackingEvents.map(event => event.gapMs)) },
    limitations: ['Same recorded model outputs; compares policy behavior, not sign accuracy.',
      'Prediction decisions are replayed at source-window end times, without simulating inference delivery delays.',
      'Additional accepted signs require video/action review; they may include false detections.',
      'No-hands is a visibility rule and does not prove physical rest or sign completion.'],
    originalTranscript: data.transcript, decisions, trackingEvents, acceptanceEvents: policy.events }
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(report.summary, null, 2))
}
try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
