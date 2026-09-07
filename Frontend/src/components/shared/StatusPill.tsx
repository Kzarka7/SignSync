import { DeviceState } from "../../types/device";

interface StatusPillProps {
  state: DeviceState;
}

const stateColor: Record<DeviceState, string> = {
  ready: "bg-success",
  tracking: "bg-success",
  listening: "bg-success",
  warning: "bg-amber",
  offline: "bg-text-3",
};

const ringColor: Record<DeviceState, string> = {
  ready: "border-success",
  tracking: "border-success",
  listening: "border-success",
  warning: "border-amber",
  offline: "border-text-3",
};

// The signature "pulse ring" indicator, reused across the sidebar,
// dashboard header, camera panel, and detection status panel so every
// live/AI state in the product reads as one coherent visual language.
export default function StatusPill({ state }: StatusPillProps) {
  return (
    <div className="relative flex py-1.5 pr-1.5 w-4 h-4 text-sm font-medium">
      {state !== "offline" && (
        <span
          className={`absolute inset-0 rounded-full border ${ringColor[state]} opacity-0 pulse-ring`}
        />
      )}
      <span
        className={`absolute inset-[5px] rounded-full ${stateColor[state]}`}
      />
    </div>
  );
}
