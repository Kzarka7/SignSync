import type { HandLandmarkerResult } from '@mediapipe/tasks-vision'
import type { DatasetFrame } from '../../types/dataset'
import type { Handedness, LandmarkFrameSample, LandmarkPoint } from '../../types/landmarks'
import { handProximity, type HandContact } from './videoHandOverlap'

export interface VideoHandDetection {
  landmarks: LandmarkPoint[]
  handedness?: Handedness
  score: number
}

interface Observation {
  frame: DatasetFrame
  hands: VideoHandDetection[]
}

type Assignment = [left: VideoHandDetection | undefined, right: VideoHandDetection | undefined]
type Costs = [number, number]
const sides = ['Left', 'Right'] as const
const states = [0, 1] as const

function wristDistance(a: LandmarkPoint, b: LandmarkPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function poseWristMatch(pose: LandmarkFrameSample['pose'], side: Handedness, hand: VideoHandDetection) {
  const wrist = side === 'Left' ? pose?.leftWrist : pose?.rightWrist
  const visibility = wrist?.visibility ?? 0
  return wrist && visibility >= .65 && Number.isFinite(wrist.x) && Number.isFinite(wrist.y)
    ? 2.1 * visibility * Math.max(0, 1 - wristDistance(wrist, hand.landmarks[0]) / .14)
    : 0
}

function observationCost(pose: LandmarkFrameSample['pose'], assignment: Assignment, contact?: HandContact) {
  return sides.reduce((cost, side, index) => {
    const hand = assignment[index]
    if (!hand) return cost
    const labelPenalty = hand.handedness && hand.handedness !== side ? Math.max(0, 2 * hand.score - 1) : 0
    // Handedness can flicker when fingers are covered. Let visible pose
    // wrists and observations outside the contact carry more weight here.
    return cost + labelPenalty * (contact ? .35 : 1) - poseWristMatch(pose, side, hand)
  }, 0)
}

export function readHandDetections(result: HandLandmarkerResult | null): VideoHandDetection[] {
  return result?.landmarks.flatMap((landmarks, index): VideoHandDetection[] => {
    if (landmarks.length !== 21 || !landmarks.every(({ x, y, z }) => [x, y, z].every(Number.isFinite))) return []
    const category = result.handedness?.[index]?.[0]
    const name = category?.categoryName
    return [{ landmarks, handedness: name === 'Left' || name === 'Right' ? name : undefined, score: category?.score ?? 0 }]
  }) ?? []
}

// Live tracking state for one anatomical side. Positions use
// aspect-corrected units (x scaled by width / height).
interface SideTrack {
  center: { x: number; y: number }
  // Palm-centre velocity in units per millisecond.
  velocity: { x: number; y: number }
  palm: number
  at: number
  // Smoothed handedness vote: +1 means "Left", -1 means "Right".
  label: number
}

// A side keeps full continuity through short dropouts and fades out after
// TRACK_HOLD_MS, after which the per-frame evidence decides alone.
const TRACK_HOLD_MS = 500
const FULL_CONTINUITY_MS = 150
const CONTINUITY_WEIGHT = 2.8
const LABEL_RATE = .35
const PALM_JOINTS = [0, 5, 9, 13, 17] as const

function palmCenter(hand: LandmarkPoint[], aspect: number) {
  let x = 0, y = 0
  for (const joint of PALM_JOINTS) { x += hand[joint].x; y += hand[joint].y }
  return { x: x * aspect / PALM_JOINTS.length, y: y / PALM_JOINTS.length }
}

function palmSize(hand: LandmarkPoint[], aspect: number) {
  const span = (a: number, b: number) => Math.hypot((hand[a].x - hand[b].x) * aspect, hand[a].y - hand[b].y)
  return Math.max(.02, span(0, 9), span(5, 17))
}

function frameLabel(hand: VideoHandDetection) {
  return hand.handedness ? (hand.handedness === 'Left' ? 1 : -1) * Math.max(0, 2 * hand.score - 1) : undefined
}

// How well a detection continues a side's track (0 to 1). The previous palm
// centre is extrapolated along its recent velocity, so a fast sign still
// matches its own track instead of falling back to a single label.
function trackMatch(track: SideTrack | undefined, hand: VideoHandDetection, now: number, aspect: number) {
  if (!track) return 0
  const elapsed = now - track.at
  if (elapsed <= 0 || elapsed > TRACK_HOLD_MS) return 0
  const step = Math.min(elapsed, 120)
  let dx = track.velocity.x * step, dy = track.velocity.y * step
  const shift = Math.hypot(dx, dy), limit = Math.max(.3, 3 * track.palm)
  if (shift > limit) { dx *= limit / shift; dy *= limit / shift }
  const center = palmCenter(hand.landmarks, aspect)
  const reach = Math.max(.08, 1.2 * track.palm) + .0004 * elapsed
  return Math.max(0, 1 - Math.hypot(center.x - track.center.x - dx, center.y - track.center.y - dy) / reach)
}

// Two detections of the same hand: during fast motion the previous frame's
// crop and a fresh palm detection can both report the hand, one trailing
// the other. Two real hands never share all 21 points this closely, even
// when touching.
const DUPLICATE_HAND_SPREAD = .35

export function isDuplicateHand(a: LandmarkPoint[], b: LandmarkPoint[], aspect: number) {
  let total = 0
  for (let joint = 0; joint < a.length; joint++) {
    total += Math.hypot((a[joint].x - b[joint].x) * aspect, a[joint].y - b[joint].y)
  }
  return total / a.length < DUPLICATE_HAND_SPREAD * Math.min(palmSize(a, aspect), palmSize(b, aspect))
}

function continuityWeight(elapsed: number) {
  if (elapsed <= FULL_CONTINUITY_MS) return CONTINUITY_WEIGHT
  return CONTINUITY_WEIGHT * Math.max(0, (TRACK_HOLD_MS - elapsed) / (TRACK_HOLD_MS - FULL_CONTINUITY_MS))
}

// Live observations have no lookahead. Each side keeps a short track, and
// predicted palm motion, a smoothed handedness vote and pose wrists decide
// the sides. One hand moving quickly in poor light then keeps its side
// through brief label flips and dropouts. Landmarks are passed through
// unchanged; only their left/right slot is decided here.
export function createStreamingHandAssignment() {
  let tracks: [SideTrack | undefined, SideTrack | undefined] = [undefined, undefined]
  let lastObserved = -Infinity
  let lastClose = -Infinity
  return (sample: LandmarkFrameSample, result: HandLandmarkerResult | null, aspect: number, usePoseWrists = true): LandmarkFrameSample => {
    const now = sample.timestamp
    const detections = readHandDetections(result)
    let first: VideoHandDetection | undefined = detections[0]
    let second: VideoHandDetection | undefined = detections[1]
    if (first && second && isDuplicateHand(first.landmarks, second.landmarks, aspect)) {
      if (second.score > first.score) first = second
      second = undefined
    }
    if (!first) {
      lastClose = -Infinity
      return { ...sample, leftHand: null, rightHand: null }
    }
    const elapsed = now - lastObserved
    if (elapsed <= 0) tracks = [undefined, undefined]
    if (elapsed <= 0 || elapsed > 120) lastClose = -Infinity
    const proximity = second && handProximity(first.landmarks, second.landmarks, aspect)
    const contact = proximity === 'overlap' ? 'overlap'
      : !second && now - lastClose <= 200 ? 'possible-occlusion' : undefined
    if (second) lastClose = proximity ? now : -Infinity

    // Each detection inherits the handedness vote of the track it continues
    // best, so a brief wrong label barely moves the vote.
    const evidence = new Map([first, second].flatMap(hand => {
      if (!hand) return []
      const matches = states.map(side => trackMatch(tracks[side], hand, now, aspect))
      const source: 0 | 1 = matches[0] >= matches[1] ? 0 : 1
      const match = matches[source], track = tracks[source], observed = frameLabel(hand)
      const label = match > 0 && track
        ? observed === undefined ? track.label : track.label + (observed - track.label) * (1 - (1 - LABEL_RATE) * match)
        : observed ?? 0
      return [[hand, { matches, source, label }] as const]
    }))
    const pose = usePoseWrists ? sample.pose : null
    const cost = (option: Assignment) => states.reduce<number>((total, side) => {
      const hand = option[side]
      if (!hand) return total
      const { matches, label } = evidence.get(hand)!
      const track = tracks[side]
      const contradiction = Math.max(0, (side === 0 ? -1 : 1) * label)
      // A settled vote against this side also releases the track, so a
      // wrong first label cannot lock the hand on the wrong side.
      const continuity = track ? continuityWeight(now - track.at) * matches[side] * (1 - contradiction) : 0
      return total + contradiction * (contact ? .35 : 1) - poseWristMatch(pose, sides[side], hand) - continuity
    }, 0)
    const direct: Assignment = [first, second], swapped: Assignment = [second, first]
    const chosen = cost(direct) <= cost(swapped) ? direct : swapped

    const previous = tracks
    tracks = [previous[0], previous[1]]
    for (const side of states) {
      const hand = chosen[side]
      if (!hand) continue
      const { matches, source, label } = evidence.get(hand)!
      const from = matches[source] > 0 ? previous[source] : undefined
      // The other side's track moved here, so it no longer marks a hand.
      if (from && source !== side && !chosen[source]) tracks[source] = undefined
      const center = palmCenter(hand.landmarks, aspect)
      const gap = from ? now - from.at : Infinity
      const velocity = from && gap <= FULL_CONTINUITY_MS
        ? { x: (from.velocity.x + (center.x - from.center.x) / gap) / 2, y: (from.velocity.y + (center.y - from.center.y) / gap) / 2 }
        : { x: 0, y: 0 }
      tracks[side] = { center, velocity, palm: palmSize(hand.landmarks, aspect), at: now, label }
    }
    lastObserved = now
    return { ...sample, leftHand: chosen[0]?.landmarks ?? null, rightHand: chosen[1]?.landmarks ?? null }
  }
}

function transitionCost(previous: Assignment, current: Assignment, elapsedMs: number) {
  if (elapsedMs > 120) return 0
  const reach = Math.min(.25, Math.max(.08, .12 * elapsedMs / 40))
  const weight = 2.8 * Math.min(1, 50 / Math.max(1, elapsedMs))
  return -states.reduce<number>((reward, side) => {
    const before = previous[side], after = current[side]
    return before && after
      ? reward + weight * Math.max(0, 1 - wristDistance(before.landmarks[0], after.landmarks[0]) / reach)
      : reward
  }, 0)
}

// Compare the two possible assignments across the decoded clip. Use evidence
// on either side of a short flip, but break continuity after a longer dropout.
export function assignVideoHands(observations: Observation[], contacts?: (HandContact | undefined)[]): DatasetFrame[] {
  const frames = observations.map(item => item.frame)
  const tracked = observations.flatMap(({ frame, hands }, index) => {
    const [first, second] = hands
    if (!first) return []
    const options: [Assignment, Assignment] = [[first, second], [second, first]]
    const contact = contacts?.[index]
    const costs: Costs = [observationCost(frame.raw.pose, options[0], contact), observationCost(frame.raw.pose, options[1], contact)]
    return [{ index, frame, options, costs }]
  })
  if (!tracked.length) return frames

  const prefix: Costs[] = [tracked[0].costs]
  const predecessor: Costs[] = [[0, 0]]
  const links: [Costs, Costs][] = []
  for (let index = 1; index < tracked.length; index++) {
    const previous = tracked[index - 1], current = tracked[index]
    const elapsedMs = current.frame.timestamp - previous.frame.timestamp
    const link = (from: 0 | 1, to: 0 | 1) => transitionCost(previous.options[from], current.options[to], elapsedMs)
    const transitions: [Costs, Costs] = [[link(0, 0), link(0, 1)], [link(1, 0), link(1, 1)]]
    links.push(transitions)
    const cost: Costs = [0, 0], parent: Costs = [0, 0]
    for (const to of states) {
      const fromFirst = prefix[index - 1][0] + transitions[0][to]
      const fromSecond = prefix[index - 1][1] + transitions[1][to]
      parent[to] = fromFirst <= fromSecond ? 0 : 1
      cost[to] = Math.min(fromFirst, fromSecond) + current.costs[to]
    }
    prefix.push(cost)
    predecessor.push(parent)
  }

  // Suffix costs give the margin between the best complete paths through
  // each assignment at this frame. Close alternatives need human review.
  const last = prefix.length - 1
  let state = prefix[last][0] <= prefix[last][1] ? 0 : 1
  let suffix: Costs = [0, 0]
  for (let index = last; index >= 0; index--) {
    const { frame, options, index: frameIndex } = tracked[index]
    const [left, right] = options[state]
    const corrected = !!(left?.handedness === 'Right' || right?.handedness === 'Left')
    const overlap = !!left && !!right && wristDistance(left.landmarks[0], right.landmarks[0]) < .045
    const contact = contacts?.[frameIndex]
    const uncertain = overlap || contact === 'possible-occlusion' || Math.abs(prefix[index][0] + suffix[0] - prefix[index][1] - suffix[1]) < .55
    frames[frameIndex] = {
      ...frame,
      raw: { ...frame.raw, leftHand: left?.landmarks ?? null, rightHand: right?.landmarks ?? null },
      ...(corrected || uncertain || contact ? { handAssignment: { corrected, uncertain, ...(contact ? { contact } : {}) } } : {}),
    }
    state = predecessor[index][state]
    if (index > 0) {
      const next = tracked[index].costs
      const transitions = links[index - 1]
      const suffixCost = (from: 0 | 1) => Math.min(
        transitions[from][0] + next[0] + suffix[0],
        transitions[from][1] + next[1] + suffix[1],
      )
      suffix = [suffixCost(0), suffixCost(1)]
    }
  }
  return frames
}

export function swapVideoHands(frames: DatasetFrame[]): DatasetFrame[] {
  return frames.map(frame => ({
    ...frame,
    raw: { ...frame.raw, leftHand: frame.raw.rightHand, rightHand: frame.raw.leftHand },
  }))
}

export function summarizeHandAssignments(frames: DatasetFrame[]) {
  return {
    correctedFrames: frames.filter(frame => frame.handAssignment?.corrected).length,
    uncertainFrames: frames.filter(frame => frame.handAssignment?.uncertain).length,
  }
}

export function summarizeHandContact(frames: DatasetFrame[]) {
  return {
    overlapFrames: frames.filter(frame => frame.handAssignment?.contact === 'overlap').length,
    occludedFrames: frames.filter(frame => frame.handAssignment?.contact === 'possible-occlusion').length,
  }
}
