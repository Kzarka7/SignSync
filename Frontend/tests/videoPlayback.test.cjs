const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const exportsForTest = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/dataset/videoPlayback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsForTest })
const { bindVideoReplay } = exportsForTest
function video() {
  const events = new Map()
  return { currentTime: 0, paused: true, seeking: false, plays: 0,
    addEventListener(name, fn) { events.set(name, fn) },
    removeEventListener(name, fn) { if (events.get(name) === fn) events.delete(name) },
    fire(name) { events.get(name)?.() },
    play() { this.plays++; this.paused = false; this.fire('play'); return Promise.resolve() },
    pause() { this.paused = true; this.fire('pause') },
  }
}
test('auto replay starts at the interval, repeats its exclusive end and respects pause/seeking', () => {
  const v = video(), binding = bindVideoReplay(v, 1, 2, () => assert.fail('unexpected playback error'))
  binding.play(); assert.equal(v.currentTime, 1)
  v.currentTime = 1.5; assert.equal(binding.check(1.5), false)
  v.currentTime = 2; assert.equal(binding.check(2), true); assert.equal(v.currentTime, 1)
  v.currentTime = 2.5; v.paused = true; binding.check(2.5); assert.equal(v.currentTime, 2.5)
  v.paused = false; v.seeking = true; binding.check(2.5); assert.equal(v.currentTime, 2.5)
  v.seeking = false; v.currentTime = 3; v.paused = true; v.fire('ended')
  assert.equal(v.currentTime, 1); assert.equal(v.plays, 2)
  binding.dispose(); v.currentTime = 3; v.fire('ended'); v.fire('timeupdate')
  assert.equal(v.currentTime, 3); assert.equal(binding.check(3), false)
})
test('play failures are reported while mounted and ignored after disposal', async () => {
  const v = video(); let errors = 0
  v.play = () => Promise.reject(Error('blocked'))
  const binding = bindVideoReplay(v, 0, 1, () => errors++)
  binding.play(); await Promise.resolve(); assert.equal(errors, 1)
  binding.play(); binding.dispose(); await Promise.resolve(); assert.equal(errors, 1)
})

test('stale presented frames after a restart cannot seek or stop the new playback', () => {
  for (const loop of [true, false]) {
    const v = video(); let completed = 0
    const binding = bindVideoReplay(v, 1, 2, () => assert.fail(), { loop, onComplete: () => completed++ })
    binding.play()
    v.currentTime = 1.2
    assert.equal(binding.check(2.05), false)
    assert.equal(v.currentTime, 1.2)
    assert.equal(v.paused, false)
    assert.equal(completed, 0)
    v.currentTime = 1.4
    assert.equal(binding.check(.9), false)
    assert.equal(v.currentTime, 1.4)
    v.currentTime = 2.05
    assert.equal(binding.check(2.05), true)
    assert.equal(v.currentTime, loop ? 1 : 2)
    binding.dispose()
  }
})

test('one-pass interval playback stops at the exclusive end without replaying', () => {
  const v = video(); let complete = 0
  const binding = bindVideoReplay(v, 1, 2, () => assert.fail(), { loop: false, onComplete: () => complete++ })
  binding.play(); assert.equal(v.currentTime, 1)
  v.currentTime = 2.1; binding.check(2.1)
  assert.equal(v.currentTime, 2); assert.equal(v.paused, true); assert.equal(complete, 1)
  v.fire('ended'); v.fire('timeupdate'); assert.equal(v.plays, 1)
  binding.dispose()
})

test('one-pass playback respects manual pause and detaches all callbacks', () => {
  const v = video(); let complete = 0
  const binding = bindVideoReplay(v, 1, 2, () => assert.fail(), { loop: false, onComplete: () => complete++ })
  binding.play(); v.currentTime = 1.5; v.pause()
  assert.equal(complete, 1); assert.equal(v.currentTime, 1.5)
  binding.dispose(); v.fire('ended'); assert.equal(v.plays, 1)
})
