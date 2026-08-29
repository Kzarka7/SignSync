import { HandMetal, Mic, MessageSquareText } from "lucide-react";
import { ConversationMessage } from "../../types/message";
import Card from "../shared/Card";

export default function SpeechSubtitle({
  message,
}: {
  message: ConversationMessage;
}) {
  const isSign = message.source === "sign";
  const isPhrase = message.source === "phrase";
  const time = new Date(message.timestamp).toLocaleTimeString(undefined, {
    hour12: false,
  });
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
        <span className="font-mono font-medium text-sm text-text-3 ml-auto">
          {time}
        </span>
      </div>
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
      <div
        className="absolute left-0 top-0 bottom-0 w-[4px] "
        style={{ borderLeft: `3px solid ${borderColor}` }}
      />

      {/* Content wrapper with auto-wrap rules */}
      <div className="text-2xl text-[#1E293B] font-bold leading-relaxed break-words whitespace-normal">
        {message.text}
      </div>
    </Card>
  );
}
