import { useTranslationStream } from '../hooks/useTranslationStream'
import LiveTopbar from '../components/live/LiveTopbar'
import CameraPanel from '../components/live/CameraPanel'
import ConversationTimeline from '../components/live/ConversationTimeline'
import QuickPhraseRow from '../components/live/QuickPhraseRow'
import AvatarPanel from '../components/live/AvatarPanel'
import DetectionStatusPanel from '../components/live/DetectionStatusPanel'
import PlaybackPanel from '../components/live/PlaybackPanel'
import SpeechSubtitle from '../components/live/SpeechSubtitle'

export default function LiveConversationPage() {
  const { messages, endSession, exportSession } = useTranslationStream()
  const lastMessage = messages[messages.length - 1]

  return (
    <div>
      <LiveTopbar onEnd={endSession} onExport={exportSession} />

      <div className="grid grid-cols-[3fr_2fr] gap-4 items-start">
        <div>
          <CameraPanel />
          <ConversationTimeline messages={messages} />
          <QuickPhraseRow />
        </div>

        <div className="flex flex-col gap-3.5">
          <AvatarPanel />
          <SpeechSubtitle  caption={lastMessage ? `Spoken: "${lastMessage.text}"` : 'Waiting for spoken input...'}/>
          <PlaybackPanel />
          <DetectionStatusPanel />
        </div>
      </div>
    </div>
  )
}
