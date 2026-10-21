// Compare advisory intervals with the SHA256-matched, previously reviewed originals.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const [datasetRoot, output] = process.argv.slice(2)
function load(file) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports })
  return exports
}
const { suggestSignInterval } = load(path.resolve(__dirname, '../src/services/dataset/videoDiagnostics.ts'))
const baseline = path.join(datasetRoot, 'experiments/video_collector_20261020/baseline640')
const manifest = JSON.parse(fs.readFileSync(path.join(datasetRoot, 'experiments/fsl_reference_review_2026_10_19/reviewed-manifest.json'))).clips
const clips = fs.readdirSync(baseline).filter(name => /^(visible|rest)-.*\.json$/.test(name)).map(name => {
  const data = JSON.parse(fs.readFileSync(path.join(baseline, name)))
  const reviewed = manifest.find(item => item.label === 'THANK_YOU' && item.sha256 === data.sha256)
  const suggestion = suggestSignInterval(data.frames, data.duration)
  return { filename: data.name, group: data.group, sha256: data.sha256, suggestion,
    previousManualIntervalMs: reviewed ? [reviewed.trimStartMs, reviewed.trimEndMs] : null,
    retainedManualInterval: suggestion && reviewed ? suggestion.start * 1000 <= reviewed.trimStartMs && suggestion.end * 1000 >= reviewed.trimEndMs : null,
    note: 'Advisory only. Previous contact-sheet boundaries have ±300ms uncertainty. Neither detection span nor annotation overlap certifies a complete or correct sign.' }
})
fs.mkdirSync(output, { recursive: true })
const summary = ['visible', 'rest'].map(group => {
  const items = clips.filter(clip => clip.group === group)
  return { group, clips: items.length, suggestions: items.filter(clip => clip.suggestion).length,
    retainedManualInterval: items.filter(clip => clip.retainedManualInterval === true).length,
    needsBoundaryCheckAgainstPriorReview: items.filter(clip => clip.retainedManualInterval === false).length }
})
fs.writeFileSync(path.join(output, 'interval-suggestions.json'), JSON.stringify({ summary, clips }, null, 2))
console.log(JSON.stringify(summary, null, 2))
