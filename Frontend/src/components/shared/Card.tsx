import { ReactNode } from 'react'

export default function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-border rounded-xl2 p-5 ${className}`}>
      {children}
    </div>
  )
}
