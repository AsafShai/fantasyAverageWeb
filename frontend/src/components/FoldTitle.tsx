import type { ReactNode } from 'react'

/** Clickable section title with a chevron; put it inside the section's h2. */
export function FoldTitle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="group inline-flex items-center gap-2 text-left rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className={`h-4 w-4 shrink-0 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
      >
        <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{children}</span>
    </button>
  )
}
