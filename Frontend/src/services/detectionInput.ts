export type DetectionInputWidth = 640 | null

// Capture and preview retain their original resolution. Both models receive
// the same reduced image, with its aspect ratio and normalized coordinates intact.
export function createDetectionInput(createCanvas = () => document.createElement('canvas')) {
  let canvas: HTMLCanvasElement | null = null
  return (video: HTMLVideoElement, maxWidth: DetectionInputWidth): HTMLVideoElement | HTMLCanvasElement => {
    if (maxWidth === null || video.videoWidth <= maxWidth || !video.videoHeight) return video
    canvas ??= createCanvas()
    const height = Math.max(1, Math.round(video.videoHeight * maxWidth / video.videoWidth))
    if (canvas.width !== maxWidth) canvas.width = maxWidth
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return video
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas
  }
}
