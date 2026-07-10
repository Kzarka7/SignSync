import { useState } from 'react'
import { createAvatarRenderService } from '../services/avatar/avatarRenderService'

export function useAvatarRenderer() {
  const [isRendering, setIsRendering] = useState(false)
  const [caption, setCaption] = useState('Waiting for spoken input...')

  async function render(text: string) {
    setIsRendering(true)
    const service = createAvatarRenderService()
    const result = await service.renderSpeech(text)
    setCaption(`Signing: "${result.caption}"`)
    setIsRendering(false)
    return result
  }

  return { isRendering, caption, render }
}
