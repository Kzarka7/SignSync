import { LucideIcon } from 'lucide-react'

export default function ResourceCard({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="bg-white border border-border rounded-xl2 p-4.5 cursor-pointer hover:border-[#c9d6e4] hover:-translate-y-px transition-transform" style={{ padding: '18px' }}>
      <div className="rounded-[10px] bg-signal-light text-signal flex items-center justify-center mb-3" style={{ width: 42, height: 42 }}>
        <Icon size={20} />
      </div>
      <h3 className="text-[14.5px] font-semibold mb-1">{title}</h3>
      <p className="text-xs text-text-2 leading-relaxed">{description}</p>
    </div>
  )
}
