import { ReactNode } from 'react'

export default function SettingRow({ label, description, control }: { label: string; description: string; control: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-none">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-text-2 mt-0.5">{description}</div>
      </div>
      {control}
    </div>
  )
}
