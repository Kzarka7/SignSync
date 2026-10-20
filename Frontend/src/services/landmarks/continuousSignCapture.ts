import type { LandmarkFrameSample } from '../../types/landmarks'
import { createSignBoundaryDetector } from './signBoundaryDetector'
import { toFeatureVector } from './normalize'
import type { SignRequest } from '../../types/message'

// Retain the exact timestamp range chosen by the boundary detector. Capture
// continues while earlier segments are being classified by the server.
export function createContinuousSignCapture() {
  const detector = createSignBoundaryDetector({}, { noHandsAsRest: true })
  let noHands = false
  let frames: LandmarkFrameSample[] = []
  return {
    get phase() { return detector.phase === 'ready' && noHands ? 'no-sign' : detector.phase },
    push(frame: LandmarkFrameSample) {
      noHands = toFeatureVector(frame).valid && !frame.leftHand && !frame.rightHand
      frames.push(frame)
      frames = frames.filter(f => frame.timestamp - f.timestamp <= 10000)
      return detector.push(frame).map(event => ({
        event,
        frames: event.type === 'segment' ? frames
          .filter(f => f.timestamp >= event.startMs && f.timestamp <= event.endMs)
          .map(f => ({ timestamp: f.timestamp, ...toFeatureVector(f) })) as SignRequest['frames'] : [],
      }))
    },
  }
}
