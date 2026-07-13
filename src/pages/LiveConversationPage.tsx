import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslationStream } from '../hooks/useTranslationStream'
import { useCameraFeed } from '../hooks/useCameraFeed'
import { useSessionSetupStore } from '../store/sessionSetupStore'
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
  const { isReadyToBegin, reset: resetSessionSetup } = useSessionSetupStore()

  // Guards against reaching this page without going through Session
  // Setup first (direct URL entry, browser back/forward, or a stale tab).
  // isReadyToBegin is intentionally not persisted, so a real page refresh
  // always lands here too, requiring devices to be reconfirmed.
  useEffect(() => {
    if (!isReadyToBegin) {
      navigate('/session-setup', { replace: true })
    }
  }, [isReadyToBegin, navigate])

  const { messages, endSession, exportSession, submitSpeech } = useTranslationStream()
  const lastMessage = messages[messages.length - 1]

  // Instantiated once here (not inside CameraPanel/DetectionStatusPanel
  // individually) so there's a single camera stream and detection loop -
  // both components just read from the same feed. Auto-starts because
  // Session Setup already confirmed device readiness and the user
  // explicitly pressed "Begin Conversation" - no reason to make them
  // click Start again.
  // useCameraFeed does not take arguments; it internally manages start/stop
  // based on session/device readiness. Call without parameters.
  const feed = useCameraFeed()

  function handleEnd() {
    endSession() // WS control message
    resetSessionSetup() // require Session Setup again for the next conversation
  }

  if (!isReadyToBegin) return null

  return (
    <div>
      <LiveTopbar onEnd={handleEnd} onExport={exportSession} />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[5fr_3fr] gap-4 items-start">
          <div className="flex flex-col gap-3.5">
            <CameraPanel feed={feed} />
            <SpeechSubtitle message={lastMessage ?? ({ text: 'Waiting for spoken input...' } as any)} />
            <QuickPhraseRow />
          </div>

          <div className="flex flex-col gap-3.5">
            <AvatarPanel onSubmitSpeech={submitSpeech} />
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
