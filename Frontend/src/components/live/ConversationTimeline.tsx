import { useLayoutEffect, useRef } from "react";
import { ConversationMessage } from "../../types/message";
import MessageBubble from "./MessageBubble";
import Card from "../shared/Card";

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
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldScroll = distanceToBottom <= threshold + 150;

    if (shouldScroll) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages]);

  return (
    <Card>
      <div
        ref={scrollContainerRef}
        className="max-h-[430px] overflow-y-auto flex flex-col divide-y divide-border [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-1"
      >
        {messages.length === 0 && (
          <div className="text-sm text-text-2 py-6 text-center">
            Waiting for the first signed or spoken message...
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="py-3 first:pt-0 last:pb-0">
            {/* Live Conversation's transcript now shows the same
                per-category breakdown as Session Summary's transcript -
                both read straight off each message's confidenceBreakdown,
                no separate confidence system. */}
            <MessageBubble message={m} showConfidenceBreakdown />
          </div>
        ))}
      </div>
    </Card>
  );
}
