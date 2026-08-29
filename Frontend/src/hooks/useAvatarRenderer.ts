import { useEffect, useRef, useState } from 'react'
import { createAvatarRenderService } from '../services/avatar/avatarRenderService'

// There's no real "animation finished" event to hook into yet - this is
// how long the avatar is treated as actively playing back the generated
// sign result immediately after rendering completes.
const PLAYBACK_WINDOW_MS = 2500

export function useAvatarRenderer() {
  const [isRendering, setIsRendering] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [caption, setCaption] = useState('Waiting for spoken input...')
  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current)
    }
  }, [])

  async function render(text: string) {
    if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current)
    setIsRendering(true)
    setIsPlaying(false)
    const service = createAvatarRenderService()
    const result = await service.renderSpeech(text)
    setCaption(`Signing: "${result.caption}"`)
    setIsRendering(false)
    setIsPlaying(true)
    playbackTimeoutRef.current = setTimeout(() => setIsPlaying(false), PLAYBACK_WINDOW_MS)
    return result
  }

  return { isRendering, isPlaying, caption, render }
}
