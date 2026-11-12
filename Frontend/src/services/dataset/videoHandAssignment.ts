import type { DatasetFrame } from '../../types/dataset'
import type { Handedness, LandmarkPoint } from '../../types/landmarks'

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

function observationCost(frame: DatasetFrame, assignment: Assignment) {
  const pose = frame.raw.pose
  const wrists = [pose?.leftWrist, pose?.rightWrist]
  return sides.reduce((cost, side, index) => {
    const hand = assignment[index]
    if (!hand) return cost
    const labelPenalty = hand.handedness && hand.handedness !== side ? Math.max(0, 2 * hand.score - 1) : 0
    const wrist = wrists[index]
    const visibility = wrist?.visibility ?? 0
    const poseMatch = wrist && visibility >= .65 && Number.isFinite(wrist.x) && Number.isFinite(wrist.y)
      ? 2.1 * visibility * Math.max(0, 1 - wristDistance(wrist, hand.landmarks[0]) / .14)
      : 0
    return cost + labelPenalty - poseMatch
  }, 0)
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
export function assignVideoHands(observations: Observation[]): DatasetFrame[] {
  const frames = observations.map(item => item.frame)
  const tracked = observations.flatMap(({ frame, hands }, index) => {
    const [first, second] = hands
    if (!first) return []
    const options: [Assignment, Assignment] = [[first, second], [second, first]]
    const costs: Costs = [observationCost(frame, options[0]), observationCost(frame, options[1])]
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
    const uncertain = overlap || Math.abs(prefix[index][0] + suffix[0] - prefix[index][1] - suffix[1]) < .55
    frames[frameIndex] = {
      ...frame,
      raw: { ...frame.raw, leftHand: left?.landmarks ?? null, rightHand: right?.landmarks ?? null },
      ...(corrected || uncertain ? { handAssignment: { corrected, uncertain } } : {}),
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
