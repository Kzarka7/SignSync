// Loop the processed interval without changing review, trim drafts or samples.
export function bindVideoReplay(video: HTMLVideoElement, start: number, end: number, onError: () => void,
  options: { loop?: boolean; onComplete?: () => void } = {}) {
  let alive = true
  let completed = false
  const complete = () => { if (!completed && alive) { completed = true; options.onComplete?.() } }
  const finishInterval = () => {
    if (!alive || completed) return
    completed = true
    video.pause()
    video.currentTime = start
    options.onComplete?.()
  }
  const play = () => { void video.play().catch(() => { if (alive && !completed) { onError(); complete() } }) }
  const check = (seconds = video.currentTime) => {
    if (!alive || completed || video.paused || video.seeking || !Number.isFinite(seconds) || seconds >= start && seconds < end) return false
    // A presented-frame callback can still describe the frame before a seek.
    // Only act when the player's current position agrees with that boundary.
    if (seconds >= end ? video.currentTime < end : video.currentTime >= start) return false
    if (options.loop === false && seconds >= end) { finishInterval(); return true }
    video.currentTime = start
    return true
  }
  const update = () => { check() }
  const ended = () => {
    if (!alive || completed || !video.ended && video.currentTime < end) return
    if (options.loop === false) finishInterval()
    else { video.currentTime = start; play() }
  }
  const paused = () => {
    // A pause event from the previous run can arrive after playback restarted.
    if (options.loop === false && video.paused) {
      if (video.ended || video.currentTime >= end) finishInterval()
      else complete()
    }
  }
  video.addEventListener('play', update)
  video.addEventListener('timeupdate', update)
  video.addEventListener('ended', ended)
  video.addEventListener('pause', paused)
  return {
    check,
    play: () => {
      if (!alive) return
      completed = false
      if (video.ended || video.currentTime < start || video.currentTime >= end) video.currentTime = start
      play()
    },
    dispose: () => { alive = false; video.removeEventListener('play', update); video.removeEventListener('timeupdate', update); video.removeEventListener('ended', ended); video.removeEventListener('pause', paused) },
  }
}
