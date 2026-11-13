import type { DatasetFrame } from '../../types/dataset'
import type { LandmarkPoint } from '../../types/landmarks'

export type HandContact = 'overlap' | 'possible-occlusion'

// Finger bones plus the palm outline and diagonals. Measuring these segments
// avoids treating all empty space inside a hand's bounding box as occupied.
const edges = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],
  [10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],
  [18,19],[19,20],[0,9],[0,13],[5,17]]

function distance(a: LandmarkPoint, b: LandmarkPoint, aspect: number) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}

function pointToSegment(point: LandmarkPoint, a: LandmarkPoint, b: LandmarkPoint, aspect: number) {
  const dx = (b.x - a.x) * aspect, dy = b.y - a.y
  const x = (point.x - a.x) * aspect, y = point.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, (x * dx + y * dy) / lengthSquared)) : 0
  return Math.hypot(x - dx * t, y - dy * t)
}

function segmentsNear(a: LandmarkPoint, b: LandmarkPoint, c: LandmarkPoint, d: LandmarkPoint, gap: number, aspect: number) {
  if (Math.max(a.x, b.x) + gap / aspect < Math.min(c.x, d.x) || Math.max(c.x, d.x) + gap / aspect < Math.min(a.x, b.x) ||
      Math.max(a.y, b.y) + gap < Math.min(c.y, d.y) || Math.max(c.y, d.y) + gap < Math.min(a.y, b.y)) return false
  const cross = (p: LandmarkPoint, q: LandmarkPoint, r: LandmarkPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    pointToSegment(a, c, d, aspect) <= gap || pointToSegment(b, c, d, aspect) <= gap ||
    pointToSegment(c, a, b, aspect) <= gap || pointToSegment(d, a, b, aspect) <= gap
}

function handProximity(left: LandmarkPoint[], right: LandmarkPoint[], aspect: number) {
  const palm = (hand: LandmarkPoint[]) => Math.max(distance(hand[0], hand[9], aspect), distance(hand[5], hand[17], aspect))
  const gap = Math.max(.004, Math.min(.022, Math.min(palm(left), palm(right)) * .2))
  const near = (margin: number) => edges.some(([a, b]) => edges.some(([c, d]) =>
    segmentsNear(left[a], left[b], right[c], right[d], margin, aspect)))
  if (near(gap)) return 'overlap'
  return near(gap * 2.5) ? 'near' : undefined
}

export function detectVideoHandContact(frames: DatasetFrame[], aspect: number): (HandContact | undefined)[] {
  const proximity = frames.map(({ raw }) => raw.leftHand && raw.rightHand
    ? handProximity(raw.leftHand, raw.rightHand, aspect) : undefined)
  const contact: (HandContact | undefined)[] = proximity.map(value => value === 'overlap' ? value : undefined)
  const hasBoth = ({ raw }: DatasetFrame) => !!(raw.leftHand && raw.rightHand)
  let before = -1
  for (let after = 0; after < frames.length; after++) {
    if (!hasBoth(frames[after])) continue
    // A brief one-hand gap needs observations on both ends and evidence that
    // the hands were close. Missing landmarks stay missing during the gap.
    if (before >= 0 && after > before + 1 && frames[after].timestamp - frames[before].timestamp <= 200 &&
        (proximity[before] || proximity[after])) {
      const missing = frames.slice(before + 1, after)
      if (missing.every(({ raw }) => !!(raw.leftHand || raw.rightHand))) {
        contact.fill('possible-occlusion', before + 1, after)
      }
    }
    before = after
  }
  return contact
}
