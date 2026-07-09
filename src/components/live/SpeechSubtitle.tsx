import { HandMetal, Mic } from "lucide-react";
import { ConversationMessage } from "../../types/message";
import Card from "../shared/Card";

export default function SpeechSubtitle({
  message,
}: {
  message: ConversationMessage;
}) {
  const isSign = message.source === "sign";
  const time = new Date(message.timestamp).toLocaleTimeString(undefined, {
    hour12: false,
  });

  return (
    <Card className="relative overflow-hidden pl-7 w-full min-w-0">
      {/* Left Vertical Blue Accent Bar */}
      <div className="flex justify-between items-center">
        <span className="text-sm text-text-2 font-medium uppercase tracking-wide">Transcription</span>
        <span className="font-mono text-xs text-text-3 ml-auto">{time}</span>
      </div>
      <div className="flex items-center gap-2 my-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-2">
          <span
            className={`w-6 h-6 rounded-md flex items-center justify-center ${isSign ? "bg-signal-light text-signal" : "bg-[#EFF3F7] text-trust"}`}
          >
            {isSign ? <HandMetal size={14} /> : <Mic size={14} />}
          </span>
          {isSign ? "Signed" : "Spoken"}
        </span>
      </div>
      <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[#0A56D0]" />

      {/* Content wrapper with auto-wrap rules */}
      <div className="text-xl text-[#1E293B] font-bold leading-relaxed break-words whitespace-normal">
        {message.text}
      </div>
    </Card>
  );
}
