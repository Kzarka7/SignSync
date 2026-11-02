// Read-only oracle for the Python importer: execute the collector's actual code.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const frontend = path.resolve(__dirname, '../../Frontend')
const ts = require(path.join(frontend, 'node_modules/typescript'))
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  vm.runInNewContext(code, { exports, require: name => load(path.resolve(path.dirname(file), name + '.ts')) })
  return exports
}
const collector = load(path.join(frontend, 'src/services/landmarks/normalize.ts'))
const fixture = JSON.parse(fs.readFileSync(path.join(frontend, 'tests/fixtures/one6Landmarks.json')))
const names = ['nose','leftShoulder','rightShoulder','leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip']
const point = p => ({ x:p[0], y:p[1], z:p[2], ...(p.length > 3 ? {visibility:p[3]} : {}) })
const frames = fixture.frames.slice(0, 10).map(([timestamp, pose, left, right]) => ({
  timestamp, pose: pose ? Object.fromEntries(names.map((n,i)=>[n,point(pose[i])])) : null,
  leftHand: left?.map(point) ?? null, rightHand: right?.map(point) ?? null
}))
process.stdout.write(JSON.stringify({schema:collector.buildFeatureSchema(), frames,
  results:frames.map(collector.toFeatureVector)}))
