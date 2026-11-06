import { useRef, type KeyboardEvent } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group, e.g. "Layout". */
  label: string
  size?: 'md' | 'sm'
  className?: string
}

/**
 * Segmented control (Table / Cards, Per Game / Totals …). A radio group:
 * arrow keys move the selection, like native radios.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', className = '' }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = (i + step + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label} className={`mr-seg ${size === 'sm' ? 'mr-sm' : ''} ${className}`.trim()} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className="mr-seg-btn"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
