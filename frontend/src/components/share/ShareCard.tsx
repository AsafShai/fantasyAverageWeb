import type { ReactNode } from 'react'
import './ShareCard.css'

export interface ShareCardTheme {
  dark: boolean
}

interface ShareCardProps extends ShareCardTheme {
  /** Top-right label in the brand row, e.g. "8-cat roto". */
  kicker: string
  title: string
  subtitle: string
  footer?: ReactNode
  /** Wider card for tables with many columns (e.g. 8 categories + Tot + GP). */
  wide?: boolean
  children: ReactNode
}

/** Frame every share card uses: branded header, body, optional footer. */
export const ShareCard = ({ dark, kicker, title, subtitle, footer, wide = false, children }: ShareCardProps) => (
  <div className={`share-card${wide ? ' share-card--wide' : ''}${dark ? ' share-card--dark' : ''}`}>
    <div className="share-card__head">
      <div className="share-card__brand">
        <span>🏀 Fantasy League</span>
        <span>{kicker}</span>
      </div>
      <div className="share-card__title">{title}</div>
      <div className="share-card__subtitle">{subtitle}</div>
    </div>
    {children}
    {footer && <div className="share-card__foot">{footer}</div>}
  </div>
)
