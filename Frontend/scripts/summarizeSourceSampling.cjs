const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const [datasetRoot] = process.argv.slice(2)
const location = path.join(datasetRoot, 'experiments/source_sampling_20261021')
function load(file) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports, require: name => load(path.resolve(path.dirname(file), name + '.ts')) })
  return exports
}
const { assessVideoQuality } = load(path.resolve(__dirname, '../src/services/dataset/videoQuality.ts'))
const annotations = JSON.parse(fs.readFileSync(path.join(datasetRoot, 'experiments/fsl_reference_review_2026_10_19/reviewed-manifest.json'))).clips
const rows = []
for (const fps of [20, 30, 60]) {
  const folder = path.join(location, `aligned${fps}`)
  for (const name of fs.readdirSync(folder).filter(name => /^(rest|visible)-.*\.json$/.test(name))) {
    const item = JSON.parse(fs.readFileSync(path.join(folder, name)))
    const annotation = annotations.find(annotation => annotation.label === 'THANK_YOU' && annotation.sha256 === item.sha256)
    const start = annotation ? annotation.trimStartMs / 1000 : 0, end = annotation ? annotation.trimEndMs / 1000 : item.duration
    const selected = item.frames.filter(frame => frame.sourceTimestampMs >= start * 1000 && frame.sourceTimestampMs < end * 1000)
      .map(frame => ({ ...frame, timestamp: frame.sourceTimestampMs - start * 1000, raw: { ...frame.raw, timestamp: frame.sourceTimestampMs - start * 1000 } }))
    const quality = assessVideoQuality(selected, 'either', { endMs: (end - start) * 1000, fps: item.sampling.effectiveTargetFps })
    const unique = new Set(item.frames.map(frame => frame.sourceTimestampMs)).size
    if (unique !== item.frames.length || item.sampling.selectedFrames !== item.frames.length) throw Error('Invalid selection counts')
    rows.push({ filename: item.name, group: item.group, fingerprint: item.sha256, requestedFps: fps, sampling: item.sampling,
      fullFrames: item.frames.length, uniqueSourceTimestamps: unique, fullQuality: item.quality,
      assessedInterval: [start, end], annotation: annotation ? 'Previous hash-matched contact-sheet annotation, uncertainty ±300ms; filtered full-clip detections, not fresh trimmed inference.' : 'Complete original file',
      intervalQuality: quality })
  }
}
fs.writeFileSync(path.join(location, 'comparison.json'), JSON.stringify(rows, null, 2))
let md = '# Source-aware sampling comparison — October 21, 2026\n\nSame four original files, v4 extraction, 640-pixel cap, same tracking models. No source video was modified. All rows contain distinct decoded presentation timestamps; no duplicate-timestamp frames were retained. Static image content at different timestamps is legitimate.\n\n'
md += '| Original | Target | Source average FPS | Actual landmark FPS | Frames | Sign-interval usable | Longest interval gap |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n'
for (const row of rows) md += `| ${row.filename} | ${row.requestedFps} | ${row.sampling.sourceAverageFps.toFixed(2)} | ${row.sampling.achievedFps.toFixed(2)} | ${row.fullFrames} | ${row.intervalQuality.usableFrames}/${row.intervalQuality.totalFrames} (${(100 * row.intervalQuality.usableFrames / row.intervalQuality.totalFrames).toFixed(1)}%) | ${Math.round(row.intervalQuality.longestGapMs)} ms |\n`
md += '\nThe reference MOV interval results filter prior manual intervals from the full-clip tracking pass. Those boundaries have ±300ms uncertainty and do not certify sign correctness. The visible-hand files use their full interval. Coverage and tracking-gap continuity are technical measurements; they do not measure landmark-position accuracy or model recognition accuracy.\n\nThe phone MP4 includes a non-zero first video timestamp (about 89.9ms). The extractor preserves this media timeline so native preview, trimming and exported source timestamps align. The sourceTimeOriginSeconds field records the first PTS without subtracting it.\n\n30 FPS remains the default target. 60 FPS is optional and source-limited. More frames provide denser temporal observations; a higher rate did not establish a universal improvement in usable coverage. The camera source setting, extracted frame rate and offline processing throughput are separate measurements. Headless development processing times include cold model loading and software/hardware contention and do not predict a user device’s real-time speed.\n\nDiscard the preliminary benchmark20/30/60 folders when interpreting this result; they were diagnostic runs before correcting the phone timestamp offset. Only aligned20/30/60 feed this comparison. Original user exports remain unchanged.\n'
fs.writeFileSync(path.join(location, 'REPORT.md'), md)
console.log(md)
