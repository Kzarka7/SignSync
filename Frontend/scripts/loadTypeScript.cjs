const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Local offline tooling; executes repository modules, never code from exports.
module.exports = function loadTypeScript(entry) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (cache.has(file)) return cache.get(file)
    const exports = {}; cache.set(file, exports)
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText
    vm.runInNewContext(code, { exports,
      require: name => {
        if (!name.startsWith('.')) throw new Error('Unexpected runtime dependency: ' + name)
        return load(path.resolve(path.dirname(file), name + '.ts'))
      },
    }, { filename: file })
    return exports
  }
  return load(entry)
}
