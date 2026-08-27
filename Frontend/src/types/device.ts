// Mirrors the state MediaPipe (camera/hands/face) and the audio pipeline
// (microphone/speaker) will report once integrated.
export type DeviceState = 'ready' | 'tracking' | 'listening' | 'warning' | 'offline'

export interface DeviceStatus {
  camera: DeviceState
  hands: DeviceState
  face: DeviceState
  microphone: DeviceState
  speaker: DeviceState
  ai: DeviceState
  lightLevel: DeviceState
}
