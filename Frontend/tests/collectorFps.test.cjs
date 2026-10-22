const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

function loadComponent(name, globals = {}, react = React) {
  function load(file) {
    if (!fs.existsSync(file) && file.endsWith('.tsx')) file = file.slice(0, -1)
    const exports = {}
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      },
    }).outputText
    vm.runInNewContext(code, {
      exports, ...globals,
      require: name => name === 'react' ? react
        : name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.tsx'))
        : require(name),
    }, { filename: file })
    return exports
  }
  return load(path.resolve(__dirname, '../src/components/collector', name + '.tsx')).default
}

test('saved FPS uses frame intervals, including short and invalid samples', () => {
  const SequenceList = loadComponent('SequenceList')
  for (const [count, durationMs, expected] of [
    [31, 1000, '30.0'], [2, 1000, '1.0'], [0, 0, '—'],
    [1, 1000, '—'], [10, 0, '—'], [10, -1, '—'], [10, NaN, '—'], [10, Infinity, '—'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(SequenceList, {
      sequences: [{ id: 'test', label: 'TEST', frames: Array(count).fill({}), durationMs,
        createdAt: '2026-10-14T00:00:00Z' }],
    }))
    assert.match(html, new RegExp(`${expected} (?:avg )?FPS`))
  }
})

test('preserved video uses shared controls with elapsed time and a save-video action instead of inferred-frame counts', () => {
  const RecordingControls = loadComponent('RecordingControls')
  const html = renderToStaticMarkup(React.createElement(RecordingControls, {
    isRecording: true, countdown: null, frameCount: 0, processedFramesRef: { current: 0 },
    stopLabel: 'Stop & save video', recordingStatus: 'Recording · 2.0s',
  }))
  assert.match(html, /Stop &amp; save video/)
  assert.match(html, /Recording · 2.0s/)
  assert.doesNotMatch(html, /0 frames|FPS/)
  assert.match(html, /Discard/)
})

test('saved samples offer Export as ZIP beside Clear all without a merged JSON export', () => {
  const SequenceList = loadComponent('SequenceList')
  for (const zipReady of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(SequenceList, {
      sequences: [{ id: 'sample', label: 'HELLO', frames: [], durationMs: 0, createdAt: '2026-10-22T00:00:00Z' }],
      zipReady, isExportingZip: false,
    }))
    assert.match(html, /Export as ZIP<\/button><button[^>]*>Clear all<\/button><\/div>/)
    assert.match(html, /one JSON file per sample/)
    assert.doesNotMatch(html, /Export merged JSON|Other exports and storage|Download sample ZIP|Prepare training package|Download training package|Training package/)
  }
})

test('pending camera videos share Recorded samples without appearing as approved exports or another card', () => {
  const SequenceList = loadComponent('SequenceList')
  const html = renderToStaticMarkup(React.createElement(SequenceList, {
    sequences: [], collapsible: true,
    pendingVideos: [{ id: 'pending', file: { name: 'HELLO.webm' }, label: 'HELLO', fps: 30 }],
  }))
  assert.match(html, /Recorded samples \(1\)/)
  assert.match(html, /Waiting to process/)
  assert.match(html, /Process all/)
  assert.doesNotMatch(html, /Recorded videos|No saved samples yet|Prepare training package|Export JSON/)
  assert.equal((html.match(/bg-white border border-border rounded-xl2 p-5/g) ?? []).length, 1)
})

test('live FPS counts completed callbacks over elapsed wall time, ticks once a second and cleans up', () => {
  let now = 100, tick, interval, cleared, cleanup, state = null
  const fakeReact = {
    ...React,
    useState: () => [state, next => { state = next }],
    useEffect: effect => { cleanup = effect() },
  }
  const RecordingControls = loadComponent('RecordingControls', {
    performance: { now: () => now },
    window: {
      setInterval: (callback, ms) => { tick = callback; interval = ms; return 42 },
      clearInterval: id => { cleared = id },
    },
  }, fakeReact)
  const processedFramesRef = { current: 50 }
  const tree = RecordingControls({ isRecording: true, countdown: null, frameCount: 120, processedFramesRef })
  function findLiveFps(node) {
    if (!node || typeof node !== 'object') return null
    if (typeof node.type === 'function' && node.type.name === 'LiveFps') return node
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = findLiveFps(child)
      if (found) return found
    }
    return null
  }
  const live = findLiveFps(tree)
  assert.ok(live, 'FPS must appear inside the recording controls')
  assert.match(renderToStaticMarkup(live.type(live.props)), /— FPS/)
  assert.equal(interval, 1000)
  processedFramesRef.current += 30
  now += 1000
  tick()
  assert.equal(state, 30)
  processedFramesRef.current += 30
  now += 2000 // A busy main thread delays the timer; do not assume exactly one second.
  tick()
  assert.equal(state, 15)
  now += 1000
  tick()
  assert.equal(state, 0, 'stalled detection must not retain an old FPS value')
  cleanup()
  assert.equal(cleared, 42)
})
