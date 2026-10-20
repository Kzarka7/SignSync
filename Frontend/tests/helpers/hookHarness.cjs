const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
// Minimal synchronous hook runner for camera/socket callbacks; no DOM or devices.
exports.hookHarness = function (file, exportName, imports, args = () => []) {
  const slots = []; let cursor = 0, dirty = false, effects = [], result
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const react = {
    useState(initial) {
      const i = cursor++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, value => {
        const next = typeof value === 'function' ? value(slots[i].value) : value
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
      }]
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial } },
    useCallback(callback, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, callback }
      return slots[i].callback
    },
    useEffect(callback, deps) {
      const i = cursor++
      if (!slots[i] || !same(slots[i].deps, deps)) {
        const old = slots[i]; slots[i] = { deps }
        effects.push(() => { old?.cleanup?.(); slots[i].cleanup = callback() })
      }
    },
  }
  const exports = {}
  let timer = 0
  const intervals=new Map(), listeners=new Map()
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  }}).outputText
  vm.runInNewContext(code, { exports, require: name => name === 'react' ? react : imports(name),
    setTimeout: () => ++timer, clearTimeout() {}, setInterval: fn => {const id=++timer;intervals.set(id,fn);return id}, clearInterval(id) {intervals.delete(id)},
    crypto: { randomUUID: () => 'capture-' + ++timer },
    window: { addEventListener(type,fn) {listeners.set(type,fn)}, removeEventListener(type,fn) {if(listeners.get(type)===fn)listeners.delete(type)} }, console,
  })
  return {
    tickIntervals() {for(const fn of [...intervals.values()])fn()},
    dispatchKey(event) {listeners.get('keydown')?.(event)},
    render() {
      let loops = 0
      do {
        dirty = false; cursor = 0; effects = []
        result = exports[exportName](...args())
        for (const effect of effects) effect()
        if (++loops > 25) throw Error('Hook render loop')
      } while (dirty)
      return result
    },
    unmount() { for (const slot of slots) slot?.cleanup?.() },
  }
}
