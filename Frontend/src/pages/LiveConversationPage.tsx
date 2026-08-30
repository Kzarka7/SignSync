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

  // Guards against reaching this page without going through Session
  // Setup first (direct URL entry, browser back/forward, or a stale tab).
  // isReadyToBegin is intentionally not persisted, so a real page refresh
  // always lands here too, requiring devices to be reconfirmed.
  useEffect(() => {
    if (!isReadyToBegin) {
      navigate('/session-setup', { replace: true })
    }
  }, [isReadyToBegin, navigate])

  const { messages, endSession, exportSession, submitSpeech, submitPhrase } = useTranslationStream()
  const lastMessage = messages[messages.length - 1]
  // The avatar's subtitle only ever reflects the hearing side of the
  // conversation (speech-to-text or a selected quick phrase) - never a
  // detected sign, which belongs to the other direction/timeline instead.
  const lastSpokenOrPhraseMessage = [...messages].reverse().find((m) => m.source === 'speech' || m.source === 'phrase')

  // Instantiated once here (not inside CameraPanel/DetectionStatusPanel
  // individually) so there's a single camera stream and detection loop -
  // both components just read from the same feed. Auto-starts because
  // Session Setup already confirmed device readiness and the user
  // explicitly pressed "Begin Conversation" - no reason to make them
  // click Start again.
  // useCameraFeed does not take arguments; it internally manages start/stop
  // based on session/device readiness. Call without parameters.
  const feed = useCameraFeed()

  // Also instantiated once here rather than inside AvatarPanel, so
  // CameraPanel's status indicator can read the same isListening /
  // isRendering / isPlaying state instead of a second, disconnected copy.
  const speech = useSpeechRecognition()
  const avatar = useAvatarRenderer()

  // Called after LiveTopbar has already stopped the session timer (see
  // LiveTopbar.handleEnd, which calls sessionStore.endSession() before
  // invoking this prop) - sessionId/startedAt/elapsedSeconds are still
  // readable off the store at this point, they just aren't ticking anymore.
  function handleEnd() {
    endSession() // WS control message - also tears down via unmount below

    const { sessionId, startedAt, elapsedSeconds } = useSessionStore.getState()
    const now = Date.now()
    const startedAtMs = startedAt ?? now - elapsedSeconds * 1000

    // Only average confidence across messages that actually have one -
    // never invent a number when the pipeline didn't provide one.
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

    // Session must be persisted before the Summary is shown - save first,
    // navigate second.
    saveSession(completedSession)

    resetSessionSetup() // require Session Setup again for the next conversation
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
