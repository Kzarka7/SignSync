import { ReactNode } from 'react'

export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-6 flex gap-4 rounded-xl2 border border-border bg-white px-4 py-4 shadow-sm sm:px-5 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-base leading-relaxed text-text-2">{description}</p>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </header>
  )
}
