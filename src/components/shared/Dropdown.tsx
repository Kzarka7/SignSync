import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface DropdownOption<T extends string | number> {
  label: string;
  value: T;
}

interface DropdownProps<T extends string | number> {
  options: DropdownOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}

// Reusable custom dropdown used anywhere a native <select> would otherwise
// appear, so styling stays consistent with the rest of the design system
// (native selects render with the OS's own chrome and can't be themed).
export default function Dropdown<T extends string | number>({
  options,
  value,
  onChange,
  className = "",
  size = "md",
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const sizing = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2.5 text-sm";

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center justify-between gap-2 w-full bg-white border border-border rounded-lg font-medium text-ink hover:border-[#c9d6e4] transition-colors ${sizing}`}
      >
        {selected?.label ?? "Select..."}
        <ChevronDown
          size={14}
          className={`text-text-2 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 mt-1.5 min-w-full w-max bg-white border border-border rounded-lg shadow-lg p-1 z-20">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`flex items-center justify-between gap-3 w-full text-left my-0.5 px-3 py-2 text-sm hover:bg-signal-light transition-colors rounded-md ${
                option.value === value
                  ? "text-signal font-semibold bg-signal-light-active"
                  : "text-ink"
              }`}
            >
              {option.label}
              {option.value === value && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
