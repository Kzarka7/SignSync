import type { DatasetFrame } from '../../types/dataset'
import type { LandmarkPoint, PoseLandmarkFrame } from '../../types/landmarks'

const arms = [
  { hand: 'leftHand', shoulder: 'leftShoulder', elbow: 'leftElbow', wrist: 'leftWrist' },
  { hand: 'rightHand', shoulder: 'rightShoulder', elbow: 'rightElbow', wrist: 'rightWrist' },
] as const

export const LOW_LIGHT_MAX_DIMENSION = 960

// Sample a small center-weighted patch to decide whether to lift exposure.
// The same enhanced pixels feed both detectors, without changing coordinates.
export function createLowLightInput() {
  const probe = document.createElement('canvas'), output = document.createElement('canvas')
  probe.width = 24; probe.height = 16
  const probeContext = probe.getContext('2d', { willReadFrequently: true }), context = output.getContext('2d')
  if (!probeContext || !context || typeof context.filter !== 'string') throw Error('Low-light processing requires canvas filters in this browser.')
  let brightness = 1
  return (source: HTMLCanvasElement | OffscreenCanvas) => {
    probeContext.drawImage(source, source.width * .2, source.height * .15, source.width * .6, source.height * .7, 0, 0, probe.width, probe.height)
    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data
    let luminance = 0
    for (let i = 0; i < pixels.length; i += 4) luminance += .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]
    const mean = luminance / (pixels.length / 4)
    const target = Math.max(1, Math.min(1.4, 96 / Math.max(1, mean)))
    brightness += (target - brightness) * .25
    if (brightness < 1.02) return source
    if (output.width !== source.width) output.width = source.width
    if (output.height !== source.height) output.height = source.height
    context.filter = `brightness(${brightness.toFixed(3)}) contrast(1.04)`
    context.drawImage(source, 0, 0)
    return output
  }
}

export function stabilizeLowLightFrames(frames: DatasetFrame[], aspect: number): DatasetFrame[] {
  const distance = (a: LandmarkPoint, b: LandmarkPoint) => Math.hypot((a.x - b.x) * aspect, a.y - b.y)
  const visible = (point: LandmarkPoint) => (point.visibility ?? 0) >= .65
  const blend = (a: LandmarkPoint, p: LandmarkPoint, b: LandmarkPoint, fraction: number): LandmarkPoint => ({
    ...p, x: p.x * (1 - fraction) + (a.x + b.x) * fraction / 2,
    y: p.y * (1 - fraction) + (a.y + b.y) * fraction / 2,
    z: p.z * (1 - fraction) + (a.z + b.z) * fraction / 2,
  })
  const transientHands = new Map<number, Set<(typeof arms)[number]['hand']>>()
  for (const { hand } of arms) {
    let before = -1
    frames.forEach((frame, after) => {
      if (frame.raw[hand]) return
      if (before >= 0 && after > before + 1 && frame.timestamp - frames[before].timestamp <= 180) {
        const a = frames[before].raw.pose, b = frame.raw.pose
        if (a && b) {
          const span = distance(a.leftShoulder, a.rightShoulder)
          const wristTracks = arms.map(({ wrist }) => [a[wrist], b[wrist]] as const)
          if (span >= .04 && [a.leftShoulder, a.rightShoulder, b.leftShoulder, b.rightShoulder].every(visible) &&
              wristTracks.every(([p, q]) => visible(p) && visible(q) && distance(p, q) < .18 * span)) {
            const entirelyUnsupported = frames.slice(before + 1, after).every(candidate => {
              const point = candidate.raw[hand]?.[0]
              return point && !candidate.handAssignment?.contact &&
                wristTracks.every(([p, q]) => Math.min(distance(p, point), distance(q, point)) > .65 * span)
            })
            if (entirelyUnsupported) for (let index = before + 1; index < after; index++) {
              const hands = transientHands.get(index) ?? new Set()
              hands.add(hand)
              transientHands.set(index, hands)
            }
          }
        }
      }
      before = after
    })
  }

  return frames.map((frame, index) => {
    const before = frames[index - 1], after = frames[index + 1], pose = frame.raw.pose
    const previous = before && frame.timestamp - before.timestamp <= 85 ? before.raw : undefined
    const next = after && after.timestamp - frame.timestamp <= 85 ? after.raw : undefined
    const span = pose && visible(pose.leftShoulder) && visible(pose.rightShoulder)
      ? distance(pose.leftShoulder, pose.rightShoulder) : 0
    const raw = { ...frame.raw }
    let stabilizedPose: PoseLandmarkFrame | undefined
    let suspectArm = false, rejectedHand = false

    for (const { hand, shoulder, elbow, wrist } of arms) {
      const points = frame.raw[hand], previousHand = previous?.[hand], nextHand = next?.[hand]
      const trackJump = points && previousHand && nextHand && distance(previousHand[0], nextHand[0]) < .18 * span &&
        Math.min(distance(points[0], previousHand[0]), distance(points[0], nextHand[0])) > .5 * span
      // Require agreement from the surrounding body tracks as well. The
      // current wrist can jump to the same shadow as the hand detector.
      const previousPose = previous?.pose, nextPose = next?.pose
      const unsupportedJump = span >= .04 && trackJump && frame.handAssignment?.contact === undefined && previousPose && nextPose &&
          arms.every(({ wrist }) => {
            const a = previousPose[wrist], b = nextPose[wrist]
            return visible(a) && visible(b) && distance(a, b) < .18 * span &&
              Math.min(distance(a, points[0]), distance(b, points[0])) > .65 * span
          })
      if (transientHands.get(index)?.has(hand) || unsupportedJump) {
        raw[hand] = null
        rejectedHand = true
      } else if (points && previousHand && nextHand) {
        const palm = distance(points[0], points[9])
        if (palm >= .012 && distance(previousHand[0], points[0]) < .22 * palm && distance(points[0], nextHand[0]) < .22 * palm) {
          raw[hand] = points.map((point, joint) => {
            const a = previousHand[joint], b = nextHand[joint]
            const forward = (point.x - a.x) * (b.x - point.x) * aspect ** 2 + (point.y - a.y) * (b.y - point.y)
            return forward <= 0 && distance(a, point) < .12 * palm && distance(point, b) < .12 * palm &&
              Math.max(Math.abs(a.z - point.z), Math.abs(b.z - point.z)) < .12 * palm
              ? blend(a, point, b, .55) : point
          })
        }
      }

      const a = previous?.pose, b = next?.pose
      if (!pose || span < .04 || !a || !b || distance(a[shoulder], pose[shoulder]) > .12 * span || distance(b[shoulder], pose[shoulder]) > .12 * span) continue
      for (const [joint, anchor] of [[elbow, shoulder], [wrist, elbow]] as const) {
        if (!visible(a[joint]) || !visible(b[joint])) continue
        const point = pose[joint]
        const travel = Math.max(distance(a[joint], point), distance(b[joint], point))
        const length = (distance(a[joint], a[anchor]) + distance(b[joint], b[anchor])) / 2
        const stretched = Math.abs(distance(point, pose[anchor]) - length) > .25 * span
        const trackedHand = raw[hand]
        const handSupportsMotion = trackedHand && (previousHand || nextHand) && !frame.handAssignment?.uncertain &&
          distance(trackedHand[0], pose[wrist]) < .18 * span
        if (!handSupportsMotion && (!visible(point) || stretched) && travel > .28 * span && distance(a[joint], b[joint]) < .10 * span) {
          stabilizedPose ??= { ...pose }
          stabilizedPose[joint] = { ...blend(a[joint], point, b[joint], 1), visibility: 0 }
          suspectArm = true
        } else if (visible(point) && travel < .10 * span && distance(a[joint], b[joint]) < .065 * span) {
          stabilizedPose ??= { ...pose }
          stabilizedPose[joint] = blend(a[joint], point, b[joint], .5)
        }
      }
    }
    if (stabilizedPose) raw.pose = stabilizedPose
    return { ...frame, raw, ...(suspectArm || rejectedHand ? { lowLightFinding: { suspectArm, rejectedHand } } : {}) }
  })
}
