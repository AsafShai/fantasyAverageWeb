import type { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  /** Right side of the title row, e.g. a "Full standings" link. */
  action?: ReactNode
  as?: 'section' | 'div' | 'article'
}

/** White rounded card (radius 16, padding 14) with an optional title row. */
export function Card({ title, action, as: Tag = 'section', className = '', children, ...rest }: CardProps) {
  return (
    <Tag className={`mr-card ${className}`.trim()} {...rest}>
      {(title || action) && (
        <div className="mr-card-head">
          {title && <h2 className="mr-h2">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </Tag>
  )
}
