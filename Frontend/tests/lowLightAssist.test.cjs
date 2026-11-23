const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const load = require('../scripts/loadTypeScript.cjs')

const { createLowLightAssist, lightingRegion, measureLevel, targetGain, LOW_LIGHT_MAX_GAIN } =
  load(path.join(__dirname, '../src/services/landmarks/lowLightAssist.ts'))

// A frame whose brightness is a function of normalized position.
function frame(brightness, width = 640, height = 360) {
  return { width, height, brightness }
}

// Canvas stand-ins: the probe samples the source frame over the requested region,
// and the output records the filter used for each draw.
function fakeCanvases({ filters = true } = {}) {
  const outputs = []
  const createCanvas = () => {
    const canvas = { width: 0, height: 0, draws: [] }
    let region = null
    const context = {
      filter: filters ? 'none' : undefined,
      drawImage(source, ...args) {
        if (args.length === 8) region = { source, sx: args[0], sy: args[1], sw: args[2], sh: args[3] }
        canvas.draws.push({ source, filter: context.filter, args })
      },
      getImageData(_x, _y, w, h) {
        const data = new Uint8ClampedArray(w * h * 4)
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const x = (region.sx + (i + .5) * region.sw / w) / region.source.width
          const y = (region.sy + (j + .5) * region.sh / h) / region.source.height
          const value = region.source.brightness(x, y)
          data.set([value, value, value, 255], (j * w + i) * 4)
        }
        return { data }
      },
    }
    canvas.getContext = () => context
    outputs.push(canvas)
    return canvas
  }
  return { createCanvas, outputs }
}

function handAt(cx, cy) {
  return Array.from({ length: 21 }, (_, index) => ({ x: cx + (index % 5 - 2) * .02, y: cy + (Math.floor(index / 5) - 2) * .03, z: 0 }))
}
const sample = (rightHand, pose = null) => ({ timestamp: 0, leftHand: null, rightHand, pose })

test('normal light passes the original frame object to the detectors without drawing it', () => {
  const { createCanvas, outputs } = fakeCanvases()
  const assist = createLowLightAssist(createCanvas)
  const input = frame(() => 150)
  for (let t = 0; t < 1000; t += 33) assert.equal(assist.apply(input, sample(handAt(.5, .5)), t), input)
  assert.equal(assist.gain(), 1)
  assert.equal(outputs[1].draws.length, 0)
})

test('a backlit hand is brightened even though the frame as a whole looks bright', () => {
  const { createCanvas, outputs } = fakeCanvases()
  const assist = createLowLightAssist(createCanvas)
  // Bright window everywhere, dark silhouette of a hand around (0.5, 0.5).
  const input = frame((x, y) => Math.abs(x - .5) < .06 && Math.abs(y - .5) < .09 ? 35 : 230)
  let output
  for (let t = 0; t < 300; t += 33) output = assist.apply(input, sample(handAt(.5, .5)), t)
  assert.notEqual(output, input)
  assert.equal(output.width, input.width)
  assert.equal(output.height, input.height)
  assert.ok(assist.gain() > 2 && assist.gain() <= LOW_LIGHT_MAX_GAIN)
  assert.match(outputs[1].draws.at(-1).filter, /^brightness\(2\.\d+\)$/)
  // Lifting stops once the hand is lit again.
  const lit = frame(() => 150)
  for (let t = 300; t < 900; t += 33) output = assist.apply(lit, sample(handAt(.5, .5)), t)
  assert.equal(output, lit)
  assert.equal(assist.gain(), 1)
})

test('lighting is measured on hands first, then pose wrists, then the frame centre', () => {
  const pose = { leftWrist: { x: .7, y: .6, z: 0, visibility: .9 }, rightWrist: { x: .3, y: .6, z: 0, visibility: .2 } }
  assert.equal(lightingRegion(sample(handAt(.4, .5), pose)).source, 'hands')
  const wrists = lightingRegion(sample(null, pose))
  assert.equal(wrists.source, 'wrists')
  assert.ok(wrists.region.x < .7 && wrists.region.x + wrists.region.width > .7)
  assert.equal(lightingRegion(sample(null, { ...pose, leftWrist: { ...pose.leftWrist, visibility: .1 } })).source, 'frame')
  assert.equal(lightingRegion(null).source, 'frame')
})

test('a dark hand region uses its darker share while a frame average stays a mean', () => {
  const pixels = []
  for (let i = 0; i < 100; i++) { const v = i < 55 ? 30 : 240; pixels.push(v, v, v, 255) }
  assert.equal(Math.round(measureLevel(pixels, 'hands')), 30)
  assert.equal(Math.round(measureLevel(pixels, 'frame')), Math.round(.55 * 30 + .45 * 240))
  assert.equal(targetGain(150, 'hands', false), 1)
  assert.equal(targetGain(85, 'hands', false), 1)
  assert.ok(targetGain(85, 'hands', true) > 1)
  assert.equal(targetGain(10, 'hands', false), LOW_LIGHT_MAX_GAIN)
  assert.ok(targetGain(10, 'frame', false) < LOW_LIGHT_MAX_GAIN)
})

test('without canvas filters or a canvas the original frame is used', () => {
  const dark = frame(() => 20)
  const noFilters = createLowLightAssist(fakeCanvases({ filters: false }).createCanvas)
  assert.equal(noFilters.apply(dark, null, 0), dark)
  const noCanvas = createLowLightAssist(() => { throw Error('no canvas') })
  assert.equal(noCanvas.apply(dark, null, 0), dark)
  assert.equal(noCanvas.gain(), 1)
})
