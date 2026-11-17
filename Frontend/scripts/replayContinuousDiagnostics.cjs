// Re-run exported normalized landmarks without decoding the video again.
// Uses the same TypeScript window builder and temporal policy as the UI.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const load = require('./loadTypeScript.cjs')
const { createRecognitionWindows, createActivityPolicy, createObservationTracking, CONTINUOUS_SETTINGS, CONTINUOUS_POLICY_VERSION } = load(path.resolve(__dirname, '../src/services/landmarks/continuousRecognition.ts'))
const expectedRecognizer = 'p4-sign-rest-idle-nine-run-ensemble-graph-diagnostics'

async function main() {
  const [input, output, endpoint = 'ws://127.0.0.1:8000/ws/translate'] = process.argv.slice(2)
  if (!input || !output) throw Error('Usage: node scripts/replayContinuousDiagnostics.cjs <diagnostics.json> <new-report.json> [backend-websocket-url]')
  if (typeof WebSocket === 'undefined') throw Error('Use Node.js 22 or newer for the built-in WebSocket client.')
  if (fs.existsSync(output)) throw Error('Output already exists. Choose a new report filename.')
  const bytes = fs.readFileSync(input), data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  if (data.recognitionMode === 'segmented') throw Error('This CLI replays rolling-window exports only. Replay the original video in Recognition lab with Gesture completion selected.')
  if (data.format !== 'signsync-continuous-diagnostics' || data.version !== 1 || data.purpose !== 'development-only'
      || !Array.isArray(data.frames) || data.featureOrder?.length !== 164 || !data.settings) throw Error('Expected a development diagnostic export.')
  const url = new URL(endpoint); url.searchParams.set('model', 'p4-candidate'); url.searchParams.set('diagnostics', '1')
  const socket = new WebSocket(url)
  let work = null, timer
  const fail = error => { clearTimeout(timer); work?.reject(error); work = null }
  const ready = new Promise((resolve, reject) => {
    work = { resolve, reject }
    timer = setTimeout(() => fail(Error('Candidate loading timed out')), 180000)
  })
  socket.addEventListener('error', () => fail(Error('Cannot reach candidate backend')))
  socket.addEventListener('close', () => fail(Error('Candidate disconnected')))
  socket.addEventListener('message', event => {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'error') { fail(Error(message.payload.message)); return }
      if (message.type === 'status' && message.payload.state === 'ready'
          && (message.payload.recognizerId !== expectedRecognizer || message.payload.execution !== 'graph' || message.payload.diagnosticsProtocol !== 1)) {
        fail(Error('Backend mismatch. Restart the configured SignSync backend with graph-diagnostics v1.')); return
      }
      if (message.type === 'prediction' && message.payload.requestId === work?.id && message.payload.model !== expectedRecognizer) {
        fail(Error('Backend mismatch: unverified prediction identity.')); return
      }
      if ((message.type === 'status' && message.payload.state === 'ready' && work && !work.id)
          || (message.type === 'prediction' && message.payload.requestId === work?.id)) {
        clearTimeout(timer); const pending = work; work = null; pending?.resolve(message.payload)
      }
    } catch (error) { fail(error) }
  })
  const predict = request => new Promise((resolve, reject) => {
    work = { resolve, reject, id: request.requestId }
    timer = setTimeout(() => fail(Error('Inference timed out')), 30000)
    socket.send(JSON.stringify({ type: 'sign', payload: request }))
  })
  try {
    console.log('Loading diagnostic graph candidate…'); const backend = await ready
    const settings = { ...CONTINUOUS_SETTINGS, ...data.settings }
    const windows = createRecognitionWindows(settings), policy = createActivityPolicy(settings), tracker = createObservationTracking(settings)
    const rows = [], transcript = [], parity = [], trackingEvents = []
    let lastTracking = null
    for (const frame of data.frames) {
      if (!Number.isFinite(frame.timestamp) || frame.features?.length !== 164 || !frame.features.every(Number.isFinite)
          || typeof frame.valid !== 'boolean') throw Error('Malformed landmark frame')
      const tracking = tracker.push(frame)
      if (!lastTracking || lastTracking.state !== tracking.state || tracking.gapMs > 0) trackingEvents.push(tracking)
      lastTracking = tracking; policy.observeTracking(tracking)
      const window = windows.push(frame)
      if (!window) continue
      const { frames, ...details } = window
      const requestId = window.quality || tracking.state === 'pose-lost' ? null : `landmark-replay-${rows.length}`
      const start = performance.now()
      const prediction = requestId ? await predict({ requestId, featureOrder: data.featureOrder, frames }) : null
      const roundTripMs = requestId ? performance.now() - start : null
      const decision = policy.update(prediction, window.endMs, window.quality ?? undefined)
      rows.push({ ...details, ...decision, tracking, frameCount: frames.length, requestId, prediction, roundTripMs, resultAgeMs: 0 })
      if (decision.emit) transcript.push({ label: prediction.label, score: prediction.score, decisionMs: window.endMs, requestId })
      const previous = data.rows?.find(row => row.endMs === window.endMs)?.prediction
      if (previous && prediction) parity.push({ endMs: window.endMs, sameLabel: previous.label === prediction.label,
        sameAccepted: previous.accepted === prediction.accepted, scoreDifference: Math.abs(previous.score - prediction.score),
        sameTop3Labels: previous.top3.map(item => item.label).join('|') === prediction.top3.map(item => item.label).join('|') })
    }
    const times = rows.filter(row => row.roundTripMs !== null).map(row => row.roundTripMs).sort((a, b) => a - b)
    const report = { ...data, replayKind: 'normalized-landmark-replay', startedAt: new Date().toISOString(),
      settings, policyVersion: CONTINUOUS_POLICY_VERSION, trackingEvents, acceptanceEvents: policy.events,
      backend: { recognizerId: backend.recognizerId, execution: backend.execution,
        protocol: backend.diagnosticsProtocol, runs: backend.runs, verifiedAt: new Date().toISOString() },
      inputReport: path.basename(input), inputSha256: createHash('sha256').update(bytes).digest('hex'),
      rows, transcript, summary: { ...data.summary, windowCount: rows.length, transcriptEntries: transcript.length,
        status: 'Complete', failure: null, replacedWindows: 0, staleResults: 0,
        rearmedByNoHands: policy.events.filter(event => event.type === 'rearmed' && event.source === 'no-hands').length,
        rearmedByModel: policy.events.filter(event => event.type === 'rearmed' && event.source === 'model').length,
        medianRoundTripMs: times[Math.floor(times.length / 2)] ?? null, p95RoundTripMs: times[Math.floor(times.length * .95)] ?? null },
      executionParity: { comparedWindows: parity.length, allLabelsMatch: parity.every(item => item.sameLabel),
        allAcceptanceMatch: parity.every(item => item.sameAccepted), allTop3LabelsMatch: parity.every(item => item.sameTop3Labels),
        maxScoreDifference: parity.length ? Math.max(...parity.map(item => item.scoreDifference)) : null, windows: parity },
    }
    fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ summary: report.summary, parity: { ...report.executionParity, windows: undefined } }, null, 2))
  } finally { clearTimeout(timer); socket.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
