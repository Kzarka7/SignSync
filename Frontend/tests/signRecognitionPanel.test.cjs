const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function load(file) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText
  vm.runInNewContext(code, { exports, require: name => name.startsWith('.')
    ? load(path.resolve(path.dirname(file), name + '.tsx')) : require(name) })
  return exports
}
const Panel = load(path.resolve('src/components/live/SignRecognitionPanel.tsx')).default
function render(mode, label, accepted, phase = 'idle', busy = false, rejectionReason, continuous = false) {
  return renderToStaticMarkup(React.createElement(Panel, {
    capture: { phase, continuous, boundaryPhase: 'ready', queued: 0, feed: { cameraReady: true, poseDetected: true }, countdownSeconds: 3 },
    stream: { mode, connection: 'ready', busy, prediction: {
      label, accepted, rejectionReason, score: .99, inferenceMs: 100, frameCount: 30, top3: [{ label, score: .99 }],
    }},
  }))
}
test('candidate REST and IDLE show no sign and cannot enter conversation', () => {
  for (const label of ['REST', 'IDLE_MOVEMENT']) {
    const html = render('p4-candidate', label, false)
    assert.match(html, /No sign detected/)
    assert.doesNotMatch(html, /Add sign to conversation|IDLE_MOVEMENT/)
  }
})
test('candidate signs auto-transcribe while default accepted signs require confirmation', () => {
  assert.doesNotMatch(render('p4-candidate', 'HELLO', true), /Add sign to conversation/)
  assert.match(render('p4-candidate', 'HELLO', true), /Added to transcription automatically/)
  assert.match(render('v5', 'HELLO', true), /Add sign to conversation/)
})
test('switching model is disabled during capture and inference', () => {
  for (const [phase, busy] of [['recording', false], ['countdown', false], ['idle', true]]) {
    assert.match(render('v5', 'HELLO', true, phase, busy), /<select[^>]*disabled/)
  }
})

test('blocked candidate sign shows visibility guidance instead of a sign headline', () => {
  const html = render('p4-candidate', 'WHAT', false, 'idle', false, 'insufficient_hand_visibility')
  assert.match(html, /Sign blocked — insufficient hand visibility/)
  assert.match(html, /at least half of the recording/)
  assert.doesNotMatch(html, /Sign accepted by the candidate|Add sign to conversation/)
})

test('continuous candidate shows one stop control and no per-sign record button', () => {
  const html = render('p4-candidate', 'HELLO', true, 'idle', false, undefined, true)
  assert.match(html, /Stop continuous testing/)
  assert.match(html, /Ready for next sign/)
  assert.doesNotMatch(html, /Start recording|Add sign to conversation/)
  assert.match(html, /<select[^>]*disabled/)
  assert.doesNotMatch(render('v5', 'HELLO', true), /Start continuous testing/)
})
