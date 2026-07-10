import { USE_MOCKS } from '../api/client'

export interface AvatarRenderResult {
  caption: string
  // Placeholder for what a real avatar rig will eventually consume -
  // e.g. a sequence of sign glosses or animation cue IDs.
  signGlossSequence: string[]
}

// The contract AvatarPanel depends on for speech -> sign generation.
// Today it just echoes the text back after a short simulated delay; a
// real implementation calls the sign-generation model/service and
// resolves with actual animation instructions for the avatar rig.
export interface IAvatarRenderService {
  renderSpeech(text: string): Promise<AvatarRenderResult>
}

class MockAvatarRenderService implements IAvatarRenderService {
  async renderSpeech(text: string): Promise<AvatarRenderResult> {
    await new Promise((resolve) => setTimeout(resolve, 500)) // simulated generation delay
    return {
      caption: text,
      signGlossSequence: text.split(' '), // placeholder: one "gloss" per word
    }
  }
}

// Stub for the real integration: call the sign-generation model/service
// and map its output into AvatarRenderResult - AvatarPanel and
// useAvatarRenderer never need to change.
class RealAvatarRenderService implements IAvatarRenderService {
  async renderSpeech(text: string): Promise<AvatarRenderResult> {
    console.warn('RealAvatarRenderService not yet implemented - pending avatar generation integration')
    return { caption: text, signGlossSequence: [] }
  }
}

export function createAvatarRenderService(): IAvatarRenderService {
  return USE_MOCKS ? new MockAvatarRenderService() : new RealAvatarRenderService()
}
