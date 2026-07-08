import { useLayoutEffect, useRef } from "react";
import { ConversationMessage } from "../../types/message";
import MessageBubble from "./MessageBubble";

export default function ConversationTimeline({
  messages,
}: {
  messages: ConversationMessage[];
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // We use useLayoutEffect so we can read the DOM changes synchronously
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 100; // Increased slightly to comfortably catch user intent
    
    // Calculate distance from the bottom BEFORE we snap to the new height
    // Since the new message is already in the DOM at this lifecycle step,
    // we subtract the estimated space or use an offset check.
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;

    // If the user was within threshold distance of the bottom before the change, snap down
    const shouldScroll = distanceToBottom <= threshold + 150; // Add padding for the incoming bubble height

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
        className="max-h-[430px] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] pr-1"
      >
        {messages.length === 0 && (
          <div className="text-sm text-text-2 py-6 text-center">
            Waiting for the first signed or spoken message...
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}