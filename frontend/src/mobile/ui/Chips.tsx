import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  selected?: boolean
  /** Shows a trailing × (active-filter chips that clear on tap). */
  removable?: boolean
  children: ReactNode
}

/** Pill-shaped toggle button; dark when selected. */
export function Chip({ selected = false, removable = false, className = '', children, ...rest }: ChipProps) {
  return (
    <button type="button" aria-pressed={selected} className={`mr-chip ${className}`.trim()} {...rest}>
      {children}
      {removable && <span className="mr-chip-x" aria-hidden="true">×</span>}
    </button>
  )
}

interface ChipRowProps {
  /** Accessible name, e.g. "Period". */
  label: string
  /** Wrap onto several lines instead of scrolling sideways (inside sheets). */
  wrap?: boolean
  className?: string
  children: ReactNode
}

/** Horizontal, sideways-scrolling row of chips (wraps inside sheets). */
export function ChipRow({ label, wrap = false, className = '', children }: ChipRowProps) {
  return (
    <div role="group" aria-label={label} className={`mr-chips mr-noscroll ${wrap ? 'mr-wrap' : ''} ${className}`.trim()}>
      {children}
    </div>
  )
}

export interface ChipOption<T extends string> {
  value: T
  label: string
}

interface ChipSelectProps<T extends string> {
  label: string
  options: readonly ChipOption<T>[]
  value: T
  onChange: (value: T) => void
  wrap?: boolean
}

/** Single-choice chip row (period chips: Season / Last 30 / Last 15 …). */
export function ChipSelect<T extends string>({ label, options, value, onChange, wrap }: ChipSelectProps<T>) {
  return (
    <ChipRow label={label} wrap={wrap}>
      {options.map((o) => (
        <Chip key={o.value} selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </Chip>
      ))}
    </ChipRow>
  )
}
