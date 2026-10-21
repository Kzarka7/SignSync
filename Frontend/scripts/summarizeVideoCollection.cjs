const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const [datasetRoot, experiment] = process.argv.slice(2)
function load(file) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(code, { exports, require: name => load(path.resolve(path.dirname(file), name + '.ts')) })
  return exports
}
const { assessVideoQuality } = load(path.resolve(__dirname, '../src/services/dataset/videoQuality.ts'))
const manifest = JSON.parse(fs.readFileSync(path.join(datasetRoot, 'experiments/fsl_reference_review_2026_10_19/reviewed-manifest.json'))).clips
const results = []
for (const folder of fs.readdirSync(experiment)) {
  const location = path.join(experiment, folder)
  if (!fs.statSync(location).isDirectory()) continue
  for (const filename of fs.readdirSync(location).filter(name => /^(visible|rest)-.*\.json$/.test(name))) {
    const data = JSON.parse(fs.readFileSync(path.join(location, filename)))
    const annotation = manifest.find(clip => clip.label === 'THANK_YOU' && clip.sha256 === data.sha256)
    const quality = assessVideoQuality(data.frames)
    const selected = annotation ? data.frames.filter(frame => frame.timestamp >= annotation.trimStartMs && frame.timestamp < annotation.trimEndMs) : data.frames
    const selectedQuality = assessVideoQuality(selected)
    results.push({ run: folder, filename: data.name, group: data.group, sha256: data.sha256,
      width: data.width, height: data.height, inputWidth: data.inputWidth, inputHeight: data.inputHeight,
      duration: data.duration, elapsedMs: data.elapsedMs, quality, selectedQuality,
      interval: annotation ? [annotation.trimStartMs, annotation.trimEndMs] : [0, data.duration * 1000],
      intervalSource: annotation ? 'Prior manual contact-sheet review; source SHA256 verified; uncertainty ±300ms' : 'Full clip; no inferred boundaries',
      sourceFps: annotation?.fps ?? 'not measured' })
  }
}
const groups = []
for (const run of [...new Set(results.map(item => item.run))]) {
  for (const group of ['visible', 'rest']) {
    const items = results.filter(item => item.run === run && item.group === group)
    if (!items.length) continue
    const sum = (key, field) => items.reduce((total, item) => total + item[key][field], 0)
    groups.push({ run, group, clips: items.length, usable: sum('quality', 'usableFrames'), total: sum('quality', 'totalFrames'),
      intervalUsable: sum('selectedQuality', 'usableFrames'), intervalTotal: sum('selectedQuality', 'totalFrames'),
      left: items.reduce((n, item) => n + item.quality.coverage.leftHandFrames, 0),
      right: items.reduce((n, item) => n + item.quality.coverage.rightHandFrames, 0),
      both: items.reduce((n, item) => n + item.quality.coverage.bothHandsFrames, 0),
      processingSeconds: items.reduce((n, item) => n + item.elapsedMs, 0) / 1000 })
  }
}
fs.writeFileSync(path.join(experiment, 'analysis.json'), JSON.stringify({ groups, results }, null, 2))
console.log(JSON.stringify(groups, null, 2))
