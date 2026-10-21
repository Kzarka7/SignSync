// Loop the processed interval without changing review, trim drafts or samples.
export function bindVideoReplay(video: HTMLVideoElement, start: number, end: number, onError: () => void,
  options: { loop?: boolean; onComplete?: () => void } = {}) {
  let alive = true
  let completed = false
  const complete = () => { if (!completed && alive) { completed = true; options.onComplete?.() } }
  const play = () => { void video.play().catch(() => { if (alive) { onError(); complete() } }) }
  const check = (seconds = video.currentTime) => {
    if (!alive || completed || video.paused || video.seeking || !Number.isFinite(seconds) || seconds >= start && seconds < end) return false
    // A presented-frame callback can still describe the frame before a seek.
    // Only act when the player's current position agrees with that boundary.
    if (seconds >= end ? video.currentTime < end : video.currentTime >= start) return false
    if (options.loop === false && seconds >= end) { complete(); video.pause(); video.currentTime = end; return true }
    video.currentTime = start
    return true
  }
  const update = () => { check() }
  const ended = () => { if (alive && !completed) { if (options.loop === false) complete(); else { video.currentTime = start; play() } } }
  const paused = () => { if (options.loop === false) complete() }
  video.addEventListener('play', update)
  video.addEventListener('timeupdate', update)
  video.addEventListener('ended', ended)
  video.addEventListener('pause', paused)
  return {
    check,
    play: () => {
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start
      play()
    },
    dispose: () => { alive = false; video.removeEventListener('play', update); video.removeEventListener('timeupdate', update); video.removeEventListener('ended', ended); video.removeEventListener('pause', paused) },
  }
}
