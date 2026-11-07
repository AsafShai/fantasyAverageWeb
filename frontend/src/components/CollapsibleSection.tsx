import type { ReactNode } from 'react'

/**
 * Accessible collapsible panel for long team-page sections.
 */
export function CollapsibleSection({
  title,
  subtitle,
  open,
  onOpenChange,
  children,
  id,
  className = '',
  contentClassName = '',
}: {
  title: string
  subtitle?: string
  open: boolean
  onOpenChange: (next: boolean) => void
  children: ReactNode
  id?: string
  className?: string
  /** Extra classes on the expandable body (e.g. drop padding when child is already padded). */
  contentClassName?: string
}) {
  return (
    <section
      id={id}
      className={`overflow-hidden rounded-lg border border-gray-200 bg-white shadow dark:border-gray-700 dark:bg-gray-800 ${className}`}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id ? `${id}-panel` : undefined}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50/80 sm:px-6 dark:hover:bg-gray-700/30"
        onClick={() => onOpenChange(!open)}
      >
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">{title}</h2>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
          ) : null}
        </div>
        <span
          className="shrink-0 select-none text-lg leading-none text-gray-400 dark:text-gray-500"
          aria-hidden
        >
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open ? (
        <div
          id={id ? `${id}-panel` : undefined}
          className={`border-t border-gray-100 dark:border-gray-700 ${contentClassName}`}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}
