import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import Button from "./Button";

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

  const sizing = size === "sm" ? "min-h-10 px-2.5 py-1.5 text-sm" : "min-h-11 px-3 py-2.5 text-base";

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white font-semibold text-ink transition-colors hover:border-signal focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-signal active:scale-[0.97] ${sizing}`}
      >
        {selected?.label ?? "Select..."}
        <ChevronDown
          size={18}
          className={`text-text-2 transition-transform duration-150 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 flex max-h-[220px] min-w-full w-max flex-col overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-lg custom-scrollbar">
          {options.map((option) => (
            <Button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              variant={value === option.value ? 'primary-ghost' : 'default'}
              className="my-0.5 flex min-h-10 justify-between rounded-md border-none px-3 py-2 text-left text-base hover:bg-signal-light focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal active:scale-[0.97]"
            >
              {option.label}
              {option.value === value && <Check size={14} />}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
