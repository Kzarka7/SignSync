export default function PhraseChip({ text, onClick }: { text: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center bg-signal-light text-[#0c447c] rounded-full px-3.5 py-1.5 text-xs font-medium hover:bg-[#dcecfb] transition-colors"
    >
      {text}
    </button>
  )
}
