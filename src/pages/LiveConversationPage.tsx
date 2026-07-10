import { useTranslationStream } from '../hooks/useTranslationStream'
import { useCameraFeed } from '../hooks/useCameraFeed'
import LiveTopbar from '../components/live/LiveTopbar'
import CameraPanel from '../components/live/CameraPanel'
import ConversationTimeline from '../components/live/ConversationTimeline'
import QuickPhraseRow from '../components/live/QuickPhraseRow'
import AvatarPanel from '../components/live/AvatarPanel'
import DetectionStatusPanel from '../components/live/DetectionStatusPanel'
import PlaybackPanel from '../components/live/PlaybackPanel'
import SpeechSubtitle from '../components/live/SpeechSubtitle'

export default function LiveConversationPage() {
  const { messages, endSession, exportSession, submitSpeech } = useTranslationStream()
  const lastMessage = messages[messages.length - 1]

  // Instantiated once here (not inside CameraPanel/DetectionStatusPanel
  // individually) so there's a single camera stream and detection loop -
  // both components just read from the same feed.
  const feed = useCameraFeed()

  return (
    <div>
      <LiveTopbar onEnd={endSession} onExport={exportSession} />

      <div className="grid grid-cols-[5fr_3fr] grid gap-4 items-start">
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

        <div className="col-span-2">
          <ConversationTimeline messages={messages} />
        </div>
      </div>
    </div>
  )
}
