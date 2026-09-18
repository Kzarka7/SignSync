import { LucideIcon } from 'lucide-react'

export default function FAQCard({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <article className="flex min-h-[132px] gap-4 rounded-xl2 border border-border bg-sky p-4 sm:p-5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-signal-light text-signal" aria-hidden="true">
        <Icon size={22} />
      </div>
      <div>
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="mt-1.5 text-base leading-relaxed text-text-2">{description}</p>
      </div>
    </article>
  )
}
