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
    <div className="flex items-start justify-between gap-5 mb-6">
      <div>
        <h1 className="text-2xl font-display font-bold">{title}</h1>
        <p className="text-sm text-text-2 mt-1 max-w-lg">{description}</p>
      </div>
      {actions}
    </div>
  )
}
