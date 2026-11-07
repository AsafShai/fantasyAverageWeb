import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary'
  size?: 'md' | 'sm'
  /** Stretch to share a row equally (Full profile | Trade Analyzer). */
  grow?: boolean
}

/** 40px button; primary is the blue filled one. */
export function Button({ variant = 'default', size = 'md', grow = false, className = '', type = 'button', ...rest }: ButtonProps) {
  const cls = ['mr-btn', variant === 'primary' && 'mr-pri', size === 'sm' && 'mr-sm', grow && 'mr-grow', className].filter(Boolean).join(' ')
  return <button type={type} className={cls} {...rest} />
}
