export type DetectionInputWidth = 640 | null

// Capture and preview retain their original resolution. Both models receive
// the same reduced image, with its aspect ratio and normalized coordinates intact.
export function createDetectionInput(createCanvas = () => document.createElement('canvas')) {
  let canvas: HTMLCanvasElement | null = null
  return <Source extends HTMLVideoElement | ImageBitmap>(source: Source, maxWidth: DetectionInputWidth): Source | HTMLCanvasElement => {
    const width = 'videoWidth' in source ? source.videoWidth : source.width
    const sourceHeight = 'videoHeight' in source ? source.videoHeight : source.height
    if (maxWidth === null || width <= maxWidth || !sourceHeight) return source
    canvas ??= createCanvas()
    const height = Math.max(1, Math.round(sourceHeight * maxWidth / width))
    if (canvas.width !== maxWidth) canvas.width = maxWidth
    if (canvas.height !== height) canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return source
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas
  }
}
