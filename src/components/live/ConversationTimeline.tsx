import { useLayoutEffect, useRef } from "react";
import { ConversationMessage } from "../../types/message";
import MessageBubble from "./MessageBubble";

export default function ConversationTimeline({
  messages,
}: {
  messages: ConversationMessage[];
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 100; 
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldScroll = distanceToBottom <= threshold + 150;

    if (shouldScroll) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  return (
    <div
      className="bg-white border border-border rounded-xl2 px-4.5 pt-4.5 pb-1.5"
      style={{ padding: "18px 18px 6px" }}
    >
      <div
        ref={scrollContainerRef}
        /* 1. Added `flex flex-col` so children stack correctly for the divider
          2. Added `divide-y divide-border/60` to draw clean lines between blocks
        */
        className="max-h-[430px] overflow-y-auto flex flex-col divide-y divide-border [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-1"
      >
        {messages.length === 0 && (
          <div className="text-sm text-text-2 py-6 text-center">
            Waiting for the first signed or spoken message...
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="py-3 first:pt-0 last:pb-0">
            <MessageBubble message={m} />
          </div>
        ))}
      </div>
    </div>
  );
}