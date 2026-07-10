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
  const { messages, endSession, exportSession, submitSpeech } = useTranslationStream()
  const lastMessage = messages[messages.length - 1]

  return (
    <div>
      <LiveTopbar onEnd={endSession} onExport={exportSession} />

      <div className="grid grid-cols-[5fr_3fr] grid gap-4 items-start">
        <div className="flex flex-col gap-3.5">
          <CameraPanel />
          <SpeechSubtitle message={lastMessage ?? ({ text: 'Waiting for spoken input...' } as any)} />
          <QuickPhraseRow />
        </div>

        <div className="flex flex-col gap-3.5">
          <AvatarPanel onSubmitSpeech={submitSpeech} />
          <PlaybackPanel />
          <DetectionStatusPanel />
        </div>
        
        <div className="col-span-2">
          <ConversationTimeline messages={messages} />
        </div>
      </div>
    </div>
  )
}
