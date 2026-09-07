import { HandMetal, Mic, MessageSquareText } from "lucide-react";
import { ConversationMessage } from "../../types/message";
import Card from "../shared/Card";
import { useSessionStore } from '../../store/sessionStore'
import { formatElapsedTime, elapsedSecondsBetween } from '../../utils/time'

interface SpeechSubtitleProps {
  // null/undefined - nothing signed or spoken yet this session, so there's
  // no source to badge and no timestamp to show.
  message: ConversationMessage | null | undefined
  sessionStartedAt?: number | null
}

export default function SpeechSubtitle({ message, sessionStartedAt } : SpeechSubtitleProps ) {
  const liveStartedAt = useSessionStore((s) => s.startedAt)
  const startedAt = sessionStartedAt !== undefined ? sessionStartedAt : liveStartedAt

  const hasMessage = message != null

  const isSign = message?.source === "sign";
  const isPhrase = message?.source === "phrase";
  const time =
    hasMessage
      ? (startedAt != null
          ? formatElapsedTime(elapsedSecondsBetween(startedAt, new Date(message.timestamp).getTime()))
          : new Date(message.timestamp).toLocaleTimeString(undefined, { hour12: false }))
      : null
  const icon = isSign ? <HandMetal size={16} /> : isPhrase ? <MessageSquareText size={16} /> : <Mic size={16} />;
  const label = isSign ? "Signed" : isPhrase ? "Phrase" : "Spoken";
  const iconBg = isSign ? "bg-signal-light text-signal" : isPhrase ? "bg-success-light text-success-dark" : "bg-[#EFF3F7] text-trust";
  const borderColor = isSign ? "#2D7FF9" : isPhrase ? "#1FAA59" : "#1B4B66";

  return (
    <Card className="relative overflow-hidden pl-7 w-full min-w-0">
      <div className="flex justify-between items-center">
        <span className="text-md text-text-2 font-bold uppercase tracking-wide">
          Transcription
        </span>
        {time && (
          <span className="font-mono font-medium text-sm text-text-3 ml-auto">
            {time}
          </span>
        )}
      </div>
      {hasMessage && (
        <div className="flex items-center gap-2 my-1.5">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-text-2">
            <span
              className={`w-8 h-8 rounded-md flex items-center justify-center ${iconBg}`}
            >
              {icon}
            </span>
            {label}
          </span>
        </div>
      )}
      <div
        className="absolute left-0 top-0 bottom-0 w-[4px] "
        style={{ borderLeft: `3px solid ${hasMessage ? borderColor : '#CBD5E1'}` }}
      />

      {/* Content wrapper with auto-wrap rules */}
      <div className={`text-2xl leading-relaxed break-words whitespace-normal ${hasMessage ? 'text-[#1E293B] font-bold' : 'text-text-3 font-medium mt-1.5'}`}>
        {hasMessage ? message.text : 'Waiting for signed or spoken input...'}
      </div>
    </Card>
  );
}

