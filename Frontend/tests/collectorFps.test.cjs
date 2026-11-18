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
    isRecording: true, countdown: null,
    stopLabel: 'Stop & save video', recordingStatus: 'Recording · 2.0s',
  }))
  assert.match(html, /Stop &amp; save video/)
  assert.match(html, /Recording · 2.0s/)
  assert.doesNotMatch(html, /0 frames|FPS/)
  assert.match(html, /Discard/)
})

test('saved samples offer Prepare ZIP then Export as ZIP beside Clear all without a merged JSON export', () => {
  const SequenceList = loadComponent('SequenceList')
  for (const zipReady of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(SequenceList, {
      sequences: [{ id: 'sample', label: 'HELLO', frames: [], durationMs: 0, createdAt: '2026-10-22T00:00:00Z' }],
      zipReady, isExportingZip: false,
    }))
    assert.match(html, new RegExp(`${zipReady ? 'Export as ZIP' : 'Prepare ZIP'}<\\/button><button[^>]*>Clear all<\\/button><\\/div>`))
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

test('live camera clip download sits to the right of the landmark actions and requires a saved clip', () => {
  const SequenceList = loadComponent('SequenceList')
  for (const withClip of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(SequenceList, {
      showCameraClipDownload: true,
      sequences: [{ id: 'live', label: 'HELLO', frames: [], durationMs: 0, createdAt: '2026-11-18T00:00:00Z',
        ...(withClip ? { cameraClip: new Blob(['video'], { type: 'video/webm' }) } : {}) }],
    }))
    const download = html.match(/Clear all<\/button><\/div>(<button[^>]*>)[\s\S]*?Download all as video<\/button>/)
    assert.ok(download)
    assert.match(download[1], /\bml-auto\b/)
    assert.equal(/\bdisabled\b/.test(download[1]), !withClip)
  }
})

test('landmark progress polls captured frames every 125 ms and measures FPS over real elapsed time', () => {
  let now = 100, captured = 0, cleanup, cursor = 0
  const state = [], timers = new Map()
  const fakeReact = {
    ...React,
    useState: initial => {
      const index = cursor++
      if (!(index in state)) state[index] = initial
      return [state[index], next => { state[index] = next }]
    },
    useEffect: effect => { cleanup ??= effect() },
  }
  const RecordingControls = loadComponent('RecordingControls', {
    performance: { now: () => now },
    window: {
      setInterval: (callback, ms) => { timers.set(ms, callback); return ms },
      clearInterval: id => { timers.delete(id) },
    },
  }, fakeReact)
  const tree = RecordingControls({ isRecording: true, countdown: null, getRecordedFrameCount: () => captured })
  function findProgress(node) {
    if (!node || typeof node !== 'object') return null
    if (typeof node.type === 'function' && node.type.name === 'LiveRecordingProgress') return node
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = findProgress(child)
      if (found) return found
    }
    return null
  }
  const live = findProgress(tree)
  assert.ok(live, 'Progress must appear inside the recording controls')
  const renderProgress = () => {
    cursor = 0
    return renderToStaticMarkup(live.type(live.props))
  }
  assert.match(renderProgress(), /— FPS/)
  assert.deepEqual([...timers.keys()], [125, 1000])
  captured = 3
  assert.match(renderProgress(), /0 frames/)
  timers.get(125)()
  assert.match(renderProgress(), /3 frames/)
  captured = 30
  now += 1000
  timers.get(1000)()
  assert.match(renderProgress(), /30\.0 FPS/)
  captured += 30
  now += 2000 // A busy main thread delays the timer; do not assume exactly one second.
  timers.get(1000)()
  assert.match(renderProgress(), /15\.0 FPS/)
  now += 1000
  timers.get(1000)()
  assert.match(renderProgress(), />0\.0 FPS/, 'stalled detection must not retain an old FPS value')
  cleanup()
  assert.equal(timers.size, 0)
})
