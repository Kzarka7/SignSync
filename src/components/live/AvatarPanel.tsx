import { useState } from "react";
import Button from "../shared/Button";
import { Mic } from "lucide-react";

const speeds = [0.75, 1, 1.25] as const;

// Renders the FSL avatar area. The <svg> placeholder here is where the
// animated 3D/2D avatar rig will be mounted once the speech-to-sign
// generation pipeline is wired up.
export default function AvatarPanel() {
  const [speed, setSpeed] = useState<(typeof speeds)[number]>(1);

  return (
    <div
      className="relative bg-gradient-to-b from-[#F7FBFF] to-signal-light border border-border rounded-xl2 flex flex-col items-center justify-center p-4"
      style={{ aspectRatio: "16 / 9" }}
    >
      <div className="relative w-[88px] h-[88px] rounded-full bg-white border border-border flex items-center justify-center">
        <span className="absolute -inset-1.5 rounded-full border-[1.5px] border-signal opacity-0 pulse-ring" />
        <svg
          width="34"
          height="44"
          viewBox="0 0 34 44"
          fill="none"
          stroke="#1B4B66"
          strokeWidth="2"
        >
          <circle cx="17" cy="8" r="6" />
          <path d="M17 14v18M6 22l11-4 11 4M9 40l8-8 8 8" />
        </svg>
      </div>
      <div className="absolute bottom-4 flex items-end justify-between w-[calc(100%-28px)]">
        <div className="flex gap-1.5">
          {speeds.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`w-8 h-6 rounded-md text-[10px] flex items-center justify-center border ${
                speed === s
                  ? "bg-signal text-white border-signal"
                  : "bg-white text-text-2 border-border"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
        <Button size="md">
          <Mic size={20} />
        </Button>
      </div>
    </div>
  );
}
