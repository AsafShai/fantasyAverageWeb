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
  /** Live standings: replaces the kicker with a LIVE / FINAL stamp. */
  stamp?: { label: string; tone: 'live' | 'final' }
  footer?: ReactNode
  /** Wider card for tables with many columns (e.g. 8 categories + Tot + GP). */
  wide?: boolean
  /** Wider still, for tables that carry a change next to each number. */
  extraWide?: boolean
  children: ReactNode
}

/** Frame every share card uses: branded header, body, optional footer. */
export const ShareCard = ({ dark, kicker, title, subtitle, stamp, footer, wide = false, extraWide = false, children }: ShareCardProps) => (
  <div className={`share-card${wide ? ' share-card--wide' : ''}${extraWide ? ' share-card--xwide' : ''}${dark ? ' share-card--dark' : ''}`}>
    <div className="share-card__head">
      <div className="share-card__brand">
        <span>🏀 Fantasy League</span>
        {stamp
          ? <span className={`share-card__stamp share-card__stamp--${stamp.tone}`}>{stamp.label}</span>
          : <span>{kicker}</span>}
      </div>
      <div className="share-card__title">{title}</div>
      <div className="share-card__subtitle">{subtitle}</div>
    </div>
    {children}
    {footer && <div className="share-card__foot">{footer}</div>}
  </div>
)
