export default function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-[23px] rounded-full flex-shrink-0 transition-colors ${checked ? 'bg-signal' : 'bg-[#DCE4EC]'}`}
    >
      <span
        className={`absolute w-[17px] h-[17px] rounded-full bg-white top-[3px] transition-all ${checked ? 'left-5' : 'left-[3px]'}`}
      />
    </button>
  )
}
