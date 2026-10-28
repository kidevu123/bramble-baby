import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './button.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'lg'
  block?: boolean
  loading?: boolean
  children: ReactNode
}

export function Button({ variant = 'primary', size = 'md', block, loading, children, className, disabled, ...rest }: Props) {
  const classes = ['btn', `btn-${variant}`, `btn-${size}`, block ? 'btn-block' : '', className ?? ''].join(' ')
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="btn-spinner" aria-hidden /> : null}
      <span className={loading ? 'btn-label-loading' : undefined}>{children}</span>
    </button>
  )
}
