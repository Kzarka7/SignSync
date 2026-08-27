import { LucideIcon } from 'lucide-react'

export default function ResourceCard({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="grid grid-cols-[42px_1fr] gap-4 items-center bg-white border border-border rounded-xl2 p-[18px] cursor-pointer hover:border-[#c9d6e4] hover:-translate-y-px transition-transform">
      <div className="rounded-[10px] bg-signal-light text-signal flex items-center justify-center" style={{ width: 42, height: 42 }}>
        <Icon size={20} />
      </div>
      <div>
        <h3 className="text-md font-semibold mb-1">{title}</h3>
        <p className="text-sm text-text-2 leading-relaxed">{description}</p>
      </div>
    </div>
  )
}
