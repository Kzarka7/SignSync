const { test } = require('node:test')
const assert = require('node:assert/strict')
const { hookHarness } = require('./helpers/hookHarness.cjs')
const load = require('../scripts/loadTypeScript.cjs')
const glosses = load('src/services/landmarks/labGlosses.ts')

function find(root, predicate) {
  if (Array.isArray(root)) {
    for (const child of root) {
      const found = find(child, predicate)
      if (found) return found
    }
  } else if (root?.props) {
    if (predicate(root)) return root
    return find(root.props.children, predicate)
  }
}

test('Lab keeps the pinned v1 run and caption rules alongside the v2 experiment', async () => {
  const baseline = 'lab-signs43-similarity'
  const comparison = 'lab-signs43-similarity-v2'
  const settings = { strideMs: 150, confirmationMs: 300 }
  const sessions = []
  const transports = []
  const downloads = []
  const noop = () => {}
  const jsx = (type, props) => ({ type, props })
  const harness = hookHarness('src/pages/RecognitionLabPage.tsx', 'default', name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol() }
    if (name.endsWith('/useCameraFeed')) return { useCameraFeed: () => ({
      enabled: true, cameraReady: true, poseDetected: true, handsDetected: true,
      startPerformanceProfile: noop, stopPerformanceProfile: noop, getPerformanceReport: () => '{}',
    }) }
    if (name.endsWith('/liveRecognitionPolicy')) return { LIVE_SIGNS_MODEL: baseline,
      LIVE_RECOGNITION_POLICY: { recognitionMode: 'segmented', segmentAcceptance: 'confirmation' },
      getRecognitionConfirmation: () => ({ settings, minimumConfidence: .75 }),
    }
    if (name.endsWith('/continuousRecognition')) return { CONTINUOUS_SETTINGS: {}, displayActivity: label => label }
    if (name.endsWith('/labGlosses')) return glosses
    if (name.endsWith('/diagnosticPredictor')) return { createDiagnosticPredictor: model => {
      transports.push(model)
      return { connect: async () => ({ recognizerId: `${model}-seed42-graph-diagnostics` }), close: noop }
    } }
    if (name.endsWith('/recognitionDiagnostics')) return { createDiagnosticSession: options => {
      const session = { active: true, state: { rows: [], frames: 20, latestMs: 1000, transcript: [], status: 'Stopped' },
        stop() { this.active = false; options.onChange() },
        report() { return { modelMode: options.modelMode, transcript: this.state.transcript, settings, minimumConfidence: .75 } },
      }
      sessions.push(session)
      return session
    } }
    return { default: name }
  }, undefined, {
    AbortController, Blob,
    URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:report' }, revokeObjectURL: noop },
    document: { createElement: () => ({ click: noop }) },
  })

  const get = predicate => {
    const node = find(harness.render(), predicate)
    assert.ok(node)
    return node.props
  }
  const click = (label) => {
    const button = get(node => node.type === '../components/shared/Button'
      && [node.props.children].flat().some(child => typeof child === 'string' && child.trim() === label))
    assert.ok(!button.disabled)
    return button.onClick()
  }
  const modelSelect = () => get(node => node.type === 'select' && find(node, option => option.type === 'option' && option.props.value === baseline))
  const captionSelect = () => get(node => node.type === 'select' && find(node, option => option.type === 'option' && option.props.value === 'v2'))
  get(node => node.type === 'input' && node.props.name === 'lab-input-source' && node.props.value === 'camera').onChange()
  assert.equal(modelSelect().value, baseline)
  await click('Start recognition')
  assert.equal(modelSelect().disabled, true)
  sessions[0].state.transcript.push({ requestId: 'baseline-hello', label: 'HELLO', score: .94, decisionMs: 900 })
  click('Stop recognition')
  const glossTrack = () => get(node => node.type === '../components/live/LabGlossTrack')
  const annotation = { id: 'baseline-gloss', type: 'UNRESOLVED', reviewStatus: 'unresolved', startMs: 600, endMs: 700 }
  glossTrack().onChange([annotation])
  click('Pin baseline run')
  modelSelect().onChange({ target: { value: comparison } })
  assert.equal(captionSelect().value, 'v1')
  await click('Start recognition')
  sessions[1].state.transcript.push({ requestId: 'comparison-hello', label: 'HELLO', score: .89, decisionMs: 950 })
  click('Stop recognition')
  assert.equal(glossTrack().annotations.length, 0)
  captionSelect().onChange({ target: { value: 'v2' } })
  assert.deepEqual(transports, [baseline, comparison])
  const pinned = get(node => node.props['aria-label'] === 'Pinned baseline')
  const current = get(node => node.props['data-testid'] === 'lab-transcript')
  assert.equal(pinned.children[1].props.transcript[0].requestId, 'baseline-hello')
  assert.equal(current.children.props.transcript[0].requestId, 'comparison-hello')
  const currentRun = get(node => node.props['aria-label'] === 'Current run')
  assert.equal(pinned.children[2].props.transcript[0].requestId, 'baseline-hello')
  assert.equal(currentRun.children[2].props.transcript[0].requestId, 'comparison-hello')
  assert.equal(pinned.children[2].props.mode, 'v1')
  assert.equal(currentRun.children[2].props.mode, 'v2')
  click('Export recognition results')
  const report = JSON.parse(await downloads[0].text())
  assert.equal(report.modelMode, comparison)
  assert.equal(report.captionMode, 'v2')
  assert.equal(report.transcript[0].requestId, 'comparison-hello')
  assert.equal(report.comparisonBaseline.modelMode, baseline)
  assert.equal(report.comparisonBaseline.captionMode, 'v1')
  assert.equal(report.comparisonBaseline.transcript[0].requestId, 'baseline-hello')
  assert.deepEqual(report.comparisonBaseline.settings, settings)
  assert.equal(report.gloss.timeBase, 'camera-run-ms')
  assert.equal(report.gloss.suggestions[0].event.requestId, 'comparison-hello')
  assert.equal(report.gloss.annotations.length, 0)
  assert.equal(report.comparisonBaseline.gloss.suggestions[0].event.requestId, 'baseline-hello')
  assert.deepEqual(report.comparisonBaseline.gloss.annotations, [annotation])
  click('Clear pinned baseline')
  assert.equal(find(harness.render(), node => node.props['aria-label'] === 'Pinned baseline'), undefined)

  const standalone = 'lab-signs32-standalone'
  const similarityRecipe = 'lab-signs32-similarity'
  modelSelect().onChange({ target: { value: standalone } })
  await click('Start recognition')
  sessions[2].state.transcript.push({ requestId: 'standalone-person', label: 'PERSON', score: .98, decisionMs: 900 })
  click('Stop recognition')
  click('Pin baseline run')
  modelSelect().onChange({ target: { value: similarityRecipe } })
  await click('Start recognition')
  sessions[3].state.transcript.push({ requestId: 'similarity-student', label: 'STUDENT', score: .95, decisionMs: 950 })
  click('Stop recognition')
  click('Export recognition results')
  const recipeReport = JSON.parse(await downloads.at(-1).text())
  assert.deepEqual(transports, [baseline, comparison, standalone, similarityRecipe])
  assert.equal(recipeReport.modelMode, similarityRecipe)
  assert.equal(recipeReport.transcript[0].label, 'STUDENT')
  assert.equal(recipeReport.comparisonBaseline.modelMode, standalone)
  assert.equal(recipeReport.comparisonBaseline.transcript[0].label, 'PERSON')
  click('Clear pinned baseline')

  get(node => node.type === 'input' && node.props.name === 'lab-input-source' && node.props.value === 'video').onChange()
  const fileInput = () => get(node => node.type === 'input' && node.props.id === 'lab-video-file')
  const loadVideo = name => {
    fileInput().onChange({ target: { files: [{ name, size: 2000, lastModified: 100 }] } })
    get(node => node.type === 'video').onLoadedData({ currentTarget: { duration: 4 } })
  }
  loadVideo('review.mp4')
  modelSelect().onChange({ target: { value: comparison } })
  glossTrack().onChange([annotation])
  modelSelect().onChange({ target: { value: baseline } })
  assert.equal(glossTrack().annotations[0].id, annotation.id)
  click('Export gloss annotations')
  const videoReport = JSON.parse(await downloads.at(-1).text())
  assert.equal(videoReport.inputFile.name, 'review.mp4')
  assert.equal(videoReport.gloss.timeBase, 'video-ms')
  assert.deepEqual(videoReport.gloss.annotations, [annotation])
  loadVideo('replacement.mp4')
  assert.equal(glossTrack().annotations.length, 0)
  harness.unmount()
})
