import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslationStream } from '../hooks/useTranslationStream'
import { useCameraFeed } from '../hooks/useCameraFeed'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useAvatarRenderer } from '../hooks/useAvatarRenderer'
import { useSessionSetupStore } from '../store/sessionSetupStore'
import { useSessionStore } from '../store/sessionStore'
import { saveSession } from '../services/sessionHistoryStorage'
import { SavedSession } from '../types/session'
import LiveTopbar from '../components/live/LiveTopbar'
import CameraPanel from '../components/live/CameraPanel'
import ConversationTimeline from '../components/live/ConversationTimeline'
import QuickPhraseRow from '../components/live/QuickPhraseRow'
import AvatarPanel from '../components/live/AvatarPanel'
import DetectionStatusPanel from '../components/live/DetectionStatusPanel'
import PlaybackPanel from '../components/live/PlaybackPanel'
import SpeechSubtitle from '../components/live/SpeechSubtitle'

export default function LiveConversationPage() {
  const navigate = useNavigate()
  const { isReadyToBegin, conversationType, sessionName, reset: resetSessionSetup } = useSessionSetupStore()
  
  useEffect(() => {
    if (!isReadyToBegin) {
      navigate('/session-setup', { replace: true })
    }
  }, [isReadyToBegin, navigate])

  const { messages, endSession, exportSession, submitSpeech, submitPhrase } = useTranslationStream()
  const lastMessage = messages[messages.length - 1]
  const lastSpokenOrPhraseMessage = [...messages].reverse().find((m) => m.source === 'speech' || m.source === 'phrase')
  const feed = useCameraFeed()
  const speech = useSpeechRecognition()
  const avatar = useAvatarRenderer()
  function handleEnd() {
    endSession()

    const { sessionId, startedAt, elapsedSeconds } = useSessionStore.getState()
    const now = Date.now()
    const startedAtMs = startedAt ?? now - elapsedSeconds * 1000
    const confidences = messages
      .map((m) => m.confidence)
      .filter((c): c is number => typeof c === 'number')
    const avgConfidence =
      confidences.length > 0
        ? Math.round(confidences.reduce((sum, c) => sum + c, 0) / confidences.length)
        : null

    const completedSession: SavedSession = {
      id: sessionId ?? `session-${now}`,
      sessionName: sessionName.trim() || 'Untitled session',
      conversationType,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationSeconds: elapsedSeconds,
      messages,
      phrasesUsed: messages.filter((m) => m.source === 'phrase').map((m) => m.text),
      avgConfidence,
    }
    saveSession(completedSession)

    resetSessionSetup() 
    navigate(`/session-summary/${completedSession.id}`)
  }

  if (!isReadyToBegin) return null

  return (
    <div>
      <LiveTopbar onEnd={handleEnd} onExport={exportSession} />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[5fr_3fr] gap-4 items-start">
          <div className="flex flex-col gap-4">
            <CameraPanel
              feed={feed}
              isListening={speech.isListening}
              isInterpreting={avatar.isRendering}
              isPlaying={avatar.isPlaying}
            />
            <SpeechSubtitle message={lastMessage ?? ({ text: 'Waiting for spoken input...' } as any)} />
            <QuickPhraseRow onSelectPhrase={submitPhrase} />
          </div>

          <div className="flex flex-col gap-4">
            <AvatarPanel
              onSubmitSpeech={submitSpeech}
              speech={speech}
              avatar={avatar}
              lastMessage={lastSpokenOrPhraseMessage}
            />
            <PlaybackPanel />
            <DetectionStatusPanel feed={feed} />
          </div>
        </div>

        <div className="col-span-2">
          <ConversationTimeline messages={messages} />
        </div>
      </div>
    </div>
  )
}
