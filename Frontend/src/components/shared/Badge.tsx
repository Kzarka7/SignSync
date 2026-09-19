export default function Badge({
  tone,
  children,
  className,
}: {
  tone: "ok" | "med" | "neutral";
  children: React.ReactNode;
  className?: string;
}) {
  const styles =
    tone === "ok"
      ? "bg-success-light text-success-dark"
      : tone === "med"
        ? "bg-amber-light text-amber-dark"
        : "bg-[#EFF3F7] text-text-2";
  return (
    <span
      className={`text-sm font-semibold px-2.5 py-1 rounded-md ${styles} ${className || ""}`}
    >
      {children}
    </span>
  );
}
