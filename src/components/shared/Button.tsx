import { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'default' | 'primary' | 'primary-ghost' | 'danger' | 'danger-solid'
  size?: 'md' | 'sm'
}

const variants = {
  default: 'bg-white border-border text-ink hover:bg-sky',
  primary: 'bg-signal border-signal text-white hover:bg-[#1f6fe0]',
  'primary-ghost': 'bg-signal-light border-signal text-signal',
  danger: 'bg-danger-light border-[#f4c7c3] text-[#a3372f]',
  'danger-solid': 'bg-danger border-danger text-white hover:bg-[#a3372f]',
}

export default function Button({ children, variant = 'default', size = 'md', className = '', ...rest }: ButtonProps) {
  const sizing = size === 'sm' ? 'py-2 px-2 text-xs' : 'py-2.5 px-2.5 text-sm'
  return (
    <button
      className={`inline-flex items-center gap-2 font-semibold rounded-lg border transition-colors ${sizing} ${variants[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
