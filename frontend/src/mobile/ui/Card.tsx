import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Right side of the title row, e.g. a "Full standings" link. */
  action?: ReactNode
  as?: 'section' | 'div' | 'article'
  /** Makes the title a fold toggle; the body and action show only while open. */
  fold?: { open: boolean; onToggle: () => void }
}

/** White rounded card (radius 16, padding 14) with an optional title row. */
export function Card({ title, action, as: Tag = 'section', fold, className = '', children, ...rest }: CardProps) {
  const open = fold ? fold.open : true
  return (
    <Tag className={`mr-card ${className}`.trim()} {...rest}>
      {(title || action) && (
        <div className="mr-card-head">
          {title && (
            <h2 className="mr-h2">
              {fold ? (
                <button type="button" className="mr-fold" aria-expanded={open} onClick={fold.onToggle}>
                  <svg aria-hidden viewBox="0 0 20 20" className={`mr-fold-chev${open ? '' : ' mr-fold-closed'}`}>
                    <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>{title}</span>
                </button>
              ) : title}
            </h2>
          )}
          {open && action}
        </div>
      )}
      {open && children}
    </Tag>
  )
}
