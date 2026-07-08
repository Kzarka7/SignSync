import Card from "../shared/Card";

export default function SpeechSubtitle({ caption }: { caption: string }) {
  return (
    <Card className="relative overflow-hidden pl-7">
      {/* Left Vertical Blue Accent Bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-[#0A56D0]" />

      {/* Content wrapper */}
      <div className="text-base text-[#1E293B] font-medium leading-relaxed">
        {caption}
      </div>
    </Card>
  );
}