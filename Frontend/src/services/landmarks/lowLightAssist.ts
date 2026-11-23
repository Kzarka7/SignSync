import type { LandmarkFrameSample, LandmarkPoint } from '../../types/landmarks'

// Adaptive exposure lift for the live detection input only. The preview,
// the overlay and every landmark coordinate stay as they are: the detectors
// receive a brighter copy of the same frame, at the same size.
//
// Brightness is measured where the signer's hands are, not over the whole
// frame. With a window or lamp behind the signer the frame average looks
// fine while the hands are close to black, which is when the hand tracker
// loses a moving hand and then jumps to where it stopped.
//
// In normal light the measured level stays above the threshold and the
// detectors receive the original frame unchanged.

export interface LightingRegion { x: number; y: number; width: number; height: number }
export type LightingSource = 'hands' | 'wrists' | 'frame'

export const LOW_LIGHT_TARGET_LEVEL = 110
// The lift starts below this level and stops again above the release level.
export const LOW_LIGHT_ACTIVATE_LEVEL = 80
export const LOW_LIGHT_RELEASE_LEVEL = 95
export const LOW_LIGHT_MAX_GAIN = 2.4
// Without hands or wrists to aim at, only a dark frame overall gets a smaller lift.
const FRAME_MAX_GAIN = 1.6
const MIN_GAIN = 1.03
const PROBE_INTERVAL_MS = 100
const PROBE_SIZE = 24
// Measured level for hands and wrists: the darker share of the region, so
// a bright background between the fingers does not hide a dark hand.
const REGION_PERCENTILE = .4

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

function boundsOf(points: LandmarkPoint[], pad: number, minimum: number): LightingRegion | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { x, y } of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return null
  const padX = Math.max(pad * (maxX - minX), (minimum - (maxX - minX)) / 2, 0)
  const padY = Math.max(pad * (maxY - minY), (minimum - (maxY - minY)) / 2, 0)
  const x = clamp(minX - padX, 0, 1), y = clamp(minY - padY, 0, 1)
  const width = clamp(maxX + padX, 0, 1) - x, height = clamp(maxY + padY, 0, 1) - y
  return width > .005 && height > .005 ? { x, y, width, height } : null
}

// Where to measure: the last tracked hands, else the visible pose wrists
// (the pose model keeps finding a dark signer's arms), else the frame centre.
export function lightingRegion(reference: LandmarkFrameSample | null): { region: LightingRegion; source: LightingSource } {
  const hands = [reference?.leftHand, reference?.rightHand].flatMap(hand => hand ?? [])
  const handRegion = hands.length ? boundsOf(hands, .15, .06) : null
  if (handRegion) return { region: handRegion, source: 'hands' }
  const pose = reference?.pose
  const wrists = pose ? [pose.leftWrist, pose.rightWrist].filter(point =>
    (point.visibility ?? 0) >= .5 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1) : []
  const wristRegion = wrists.length ? boundsOf(wrists, 0, .22) : null
  if (wristRegion) return { region: wristRegion, source: 'wrists' }
  return { region: { x: .2, y: .15, width: .6, height: .7 }, source: 'frame' }
}

// Rec. 709 luma per pixel, then the mean or a lower percentile.
export function measureLevel(pixels: ArrayLike<number>, source: LightingSource) {
  const count = Math.floor(pixels.length / 4)
  if (!count) return 255
  const luma = new Float64Array(count)
  for (let i = 0; i < count; i++) luma[i] = .2126 * pixels[i * 4] + .7152 * pixels[i * 4 + 1] + .0722 * pixels[i * 4 + 2]
  if (source === 'frame') return luma.reduce((sum, value) => sum + value, 0) / count
  luma.sort()
  return luma[Math.min(count - 1, Math.floor(REGION_PERCENTILE * count))]
}

export function targetGain(level: number, source: LightingSource, active: boolean) {
  if (level >= (active ? LOW_LIGHT_RELEASE_LEVEL : LOW_LIGHT_ACTIVATE_LEVEL)) return 1
  return clamp(LOW_LIGHT_TARGET_LEVEL / Math.max(1, level), 1, source === 'frame' ? FRAME_MAX_GAIN : LOW_LIGHT_MAX_GAIN)
}

type DrawSource = HTMLVideoElement | ImageBitmap | HTMLCanvasElement
type CanvasLike = Pick<HTMLCanvasElement, 'width' | 'height' | 'getContext'>

const sizeOf = (source: DrawSource) => 'videoWidth' in source
  ? { width: source.videoWidth, height: source.videoHeight }
  : { width: source.width, height: source.height }

export function createLowLightAssist(createCanvas: () => CanvasLike = () => document.createElement('canvas')) {
  let probe: CanvasLike | null = null, output: CanvasLike | null = null
  let probeContext: CanvasRenderingContext2D | null = null, outputContext: CanvasRenderingContext2D | null = null
  let unsupported = false
  let gain = 1, goal = 1, lastProbe = -Infinity
  let lastLevel: number | null = null, lastSource: LightingSource | null = null

  function contexts() {
    if (unsupported) return false
    if (probeContext && outputContext) return true
    // Without a canvas or canvas filters the original frames are used; the
    // assist must never stop landmark tracking.
    try {
      probe = createCanvas(); output = createCanvas()
      probe.width = PROBE_SIZE; probe.height = PROBE_SIZE
      probeContext = probe.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null
      outputContext = output.getContext('2d') as CanvasRenderingContext2D | null
    } catch {
      probeContext = outputContext = null
    }
    unsupported = !probeContext || !outputContext || typeof outputContext.filter !== 'string'
    return !unsupported
  }

  function apply<Source extends DrawSource>(input: Source, reference: LandmarkFrameSample | null, timestamp: number): Source | HTMLCanvasElement {
    const { width, height } = sizeOf(input)
    if (!width || !height || !contexts()) return input
    if (timestamp - lastProbe >= PROBE_INTERVAL_MS || timestamp < lastProbe) {
      lastProbe = timestamp
      const { region, source } = lightingRegion(reference)
      try {
        probeContext!.drawImage(input, region.x * width, region.y * height,
          Math.max(1, region.width * width), Math.max(1, region.height * height), 0, 0, PROBE_SIZE, PROBE_SIZE)
        const level = measureLevel(probeContext!.getImageData(0, 0, PROBE_SIZE, PROBE_SIZE).data, source)
        goal = targetGain(level, source, gain >= MIN_GAIN)
        lastLevel = level; lastSource = source
      } catch {
        goal = 1
      }
    }
    // Ease toward the goal so exposure does not pump between probes.
    gain += (goal - gain) * .5
    if (goal === 1 && gain < MIN_GAIN) gain = 1
    if (gain < MIN_GAIN) return input
    try {
      if (output!.width !== width) output!.width = width
      if (output!.height !== height) output!.height = height
      outputContext!.filter = `brightness(${gain.toFixed(3)})`
      outputContext!.drawImage(input, 0, 0, width, height)
      outputContext!.filter = 'none'
      return output as HTMLCanvasElement
    } catch {
      unsupported = true
      gain = 1
      return input
    }
  }

  return {
    apply,
    // Gain applied to the most recent frame (1 means the original frame).
    gain: () => gain < MIN_GAIN ? 1 : gain,
    state: () => ({ gain: gain < MIN_GAIN ? 1 : gain, level: lastLevel, source: lastSource }),
  }
}
