const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const output = process.argv[2]
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: name => name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts')) : require(name) })
  return exports
}
const { assessVideoQuality } = load(path.resolve(__dirname, '../src/services/dataset/videoQuality.ts'))
const samples = JSON.parse(fs.readFileSync(path.join(output, 'batch-saved-samples.json')))
const workflow = JSON.parse(fs.readFileSync(path.join(output, 'batch-workflow.json')))
const rows = samples.map(sample => {
  const meta = sample.videoImport
  const before = assessVideoQuality(sample.frames, meta.expectedHands, { endMs: meta.trimEndMs - meta.trimStartMs, fps: meta.sampling.effectiveTargetFps })
  const after = assessVideoQuality(sample.frames, meta.expectedHands, { endMs: meta.trimEndMs - meta.trimStartMs, fps: meta.sampling.effectiveTargetFps }, meta.qualityWindow)
  if (JSON.stringify(after) !== JSON.stringify(meta.quality)) throw Error('Recomputed quality differs: ' + meta.filename)
  return { filename: meta.filename, source: workflow.rows.find(row => row.name === meta.filename).source,
    automaticTrim: !!meta.qualityWindow, interval: [meta.trimStartMs / 1000, meta.trimEndMs / 1000], assessment: meta.qualityWindow,
    oldResult: before.result, result: after.result, beforeFindings: before.findings, findings: after.findings,
    totalFrames: sample.frames.length, allUsableFrames: after.usableFrames, gesture: after.gesture, context: after.context,
    wholeIntervalGapMs: before.longestGapMs, gestureGapMs: after.longestGapMs }
})
fs.writeFileSync(path.join(output, 'quality-comparison.json'), JSON.stringify(rows, null, 2))
const summary = { samples: rows.length, automatic: rows.filter(row => row.automaticTrim).length,
  fullFallback: rows.filter(row => !row.automaticTrim).length,
  before: Object.fromEntries(['Pass','Review','Retake'].map(result => [result, rows.filter(row => row.oldResult === result).length])),
  after: Object.fromEntries(['Pass','Review','Retake'].map(result => [result, rows.filter(row => row.result === result).length])),
  clippingWarnings: rows.filter(row => row.findings.some(finding => finding.startsWith('Hands approach'))).length,
  processingVersion: samples[0].videoImport.processingVersion, testOnlyApprovals: true }
fs.writeFileSync(path.join(output, 'quality-summary.json'), JSON.stringify(summary, null, 2))
const lines = ['# Gesture/context assessment — THANK_YOU reference test', '',
  'All twenty originals from the external 105 FSL reference THANK YOU folder were processed at target 30 FPS through the isolated browser collector. Original files and user collections were not modified. The exported package uses simulated development approvals and is not a newly curated dataset.', '',
  'The before/after comparison uses identical retained frames, timestamps and trim boundaries. Only the quality-assessment scope changes; there is no interpolation, frame removal or new sign prediction.', '',
  '| File | Whole interval → separate assessment | Gesture usable | Context before/after | Selected interval (s) |', '| --- | --- | --- | --- | --- |']
for (const row of rows) lines.push(`| ${row.filename} | ${row.oldResult} → ${row.result}${row.automaticTrim ? '' : ' (full fallback)'} | ${row.gesture ? `${row.gesture.usableFrames}/${row.gesture.totalFrames}` : 'whole interval'} | ${row.context ? `${row.context.beforeFrames}/${row.context.afterFrames}` : 'not assigned'} | ${row.interval.map(value => value.toFixed(3)).join('–')} |`)
lines.push('', 'Summary: ' + JSON.stringify(summary), '',
  'Clipping warnings remain global to the selected interval. Internal gesture gaps, weak shoulders, expected hand coverage, minimum usable gesture duration and actual saved-boundary motion remain quality checks. Context missing-hand periods are informational, not classified as idle.', '',
  'The provisional gesture span is derived from full-pass hand activity before adding context margins. Human boundary review is still necessary. A technical Pass does not certify sign correctness.', '',
  'Browser verification includes the context toggle in both directions (clearing review), bulk check/uncheck and partial selection, checkbox alignment, fallback exclusion, save/export, undo, saved-sample protection and duplicate rejection. See gesture-context-quality.png and batch-workflow.json. Existing v3/v4 packages retain their previous validation policy.')
fs.writeFileSync(path.join(output, 'REPORT.md'), lines.join('\n') + '\n')
console.log(JSON.stringify(summary, null, 2))
