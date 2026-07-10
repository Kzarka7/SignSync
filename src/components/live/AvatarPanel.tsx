import { useState } from 'react'
import { ArrowUp, Check, Mic, Square } from 'lucide-react'
import { useSpeechRecognition } from '../../hooks/useSpeechRecognition'
import { useAvatarRenderer } from '../../hooks/useAvatarRenderer'

const speeds = [0.75, 1, 1.25] as const

interface AvatarPanelProps {
  onSubmitSpeech: (text: string) => void
}

// Renders the FSL avatar area (speech -> sign direction). Speech
// recognition and sign-generation are both delegated to their own
// service/hook (see hooks/useSpeechRecognition.ts and
// hooks/useAvatarRenderer.ts) so this component stays presentation-only.
export default function AvatarPanel({ onSubmitSpeech }: AvatarPanelProps) {
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1)
  const { isListening, transcript, start, stop, reset } = useSpeechRecognition()
  const { isRendering, caption, render } = useAvatarRenderer()

  function toggleMic() {
    if (isListening) stop()
    else start()
  }

  async function handleSubmit() {
    if (!transcript.trim()) return
    stop()
    const text = transcript.trim()
    onSubmitSpeech(text)
    await render(text) // speech -> sign generation, via AvatarService seam
    reset()
  }

  return (
    <div
      className="relative bg-gradient-to-b from-[#F7FBFF] to-signal-light border border-border rounded-xl2 flex flex-col items-center justify-center p-4"
      style={{ aspectRatio: '16 / 9' }}
    >
      <div className="absolute top-3.5 right-3.5 flex gap-1.5">
        {speeds.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`w-5 h-5 rounded-md text-[10px] flex items-center justify-center border ${
              speed === s ? 'bg-signal text-white border-signal' : 'bg-white text-text-2 border-border'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <div className="relative w-[88px] h-[88px] rounded-full bg-white border border-border flex items-center justify-center">
        {(isListening || isRendering) && (
          <span className="absolute -inset-1.5 rounded-full border-[1.5px] border-signal opacity-0 pulse-ring" />
        )}
        <svg width="34" height="44" viewBox="0 0 34 44" fill="none" stroke="#1B4B66" strokeWidth="2">
          <circle cx="17" cy="8" r="6" />
          <path d="M17 14v18M6 22l11-4 11 4M9 40l8-8 8 8" />
        </svg>
      </div>
      <div className="mt-3.5 text-xs text-text-2 text-center max-w-[220px] leading-relaxed">
        {isRendering ? 'Generating sign animation...' : caption}
      </div>

      {/* Subtitle container: live speech-to-text preview, before submission */}
      <div className="absolute bottom-3.5 left-3.5 right-[92px] bg-black/45 backdrop-blur-sm rounded-lg px-3 py-2 min-h-[34px] flex items-center">
        <span className="text-white text-xs leading-snug line-clamp-2">
          {transcript || (isListening ? 'Listening...' : 'Tap the microphone to speak')}
        </span>
      </div>

      <div className="absolute bottom-3.5 right-3.5 flex gap-1.5">
        <button
          onClick={toggleMic}
          title={isListening ? 'Stop microphone' : 'Start microphone'}
          className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors ${
            isListening ? 'bg-danger text-white border-danger' : 'bg-white text-text-2 border-border'
          }`}
        >
          {isListening ? <Square size={14} /> : <Mic size={14} />}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!transcript.trim()}
          title="Submit for signing"
          className={`w-8 h-8 rounded-lg flex items-center justify-center border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isListening ? 'bg-success text-white border-success' : 'bg-signal text-white border-signal'
          }`}
        >
          {isListening ? <Check size={14} /> : <ArrowUp size={14} />}
        </button>
      </div>
    </div>
  )
}
