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
