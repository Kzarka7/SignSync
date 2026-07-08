import { useState } from 'react'

const sections = ['General', 'Accessibility', 'Camera and microphone', 'AI model', 'Privacy']

export default function SettingsNav({ onSelect }: { onSelect: (section: string) => void }) {
  const [active, setActive] = useState(sections[0])

  return (
    <div className="flex flex-col gap-0.5">
      {sections.map((s) => (
        <div
          key={s}
          onClick={() => {
            setActive(s)
            onSelect(s)
          }}
          className={`px-3 py-2.5 rounded-lg text-[13.5px] font-medium cursor-pointer ${
            active === s ? 'bg-signal-light text-signal' : 'text-text-2'
          }`}
        >
          {s}
        </div>
      ))}
    </div>
  )
}
