import type { ReactNode } from 'react'
import { Chip, ChipRow } from '../ui'
import './activity.css'

interface Props<T extends string> {
  tabs: readonly T[]
  labels: Record<T, string>
  tab: T
  onTabChange: (tab: T) => void
  /** Pending trades waiting on ESPN, shown as a count on that tab. */
  pendingTab: T
  pendingCount: number
  children: ReactNode
}

/**
 * Phone League Activity (step 5): title, the five views as a chip row (still
 * `?tab=` in the URL), then the view. The Activity view is MobileActivityFeed;
 * the trade views are the same components as desktop, which already stack on a phone.
 */
export default function MobileActivity<T extends string>({ tabs, labels, tab, onTabChange, pendingTab, pendingCount, children }: Props<T>) {
  return (
    <div className="mr-root mr-page mr-act">
      <div className="mr-page-head">
        <h1 className="mr-h1">League Activity</h1>
        <span className="mr-meta">
          Every add, drop, waiver claim and trade this season. The Trades tab shows what each side of a trade actually
          got while the players were on its roster.
        </span>
      </div>
      <ChipRow label="League activity views" className="mr-act-tabs">
        {tabs.map((t) => (
          <Chip
            key={t}
            selected={t === tab}
            onClick={() => onTabChange(t)}
            aria-label={t === pendingTab && pendingCount > 0 ? `${labels[t]} (${pendingCount})` : labels[t]}
          >
            {labels[t]}
            {t === pendingTab && pendingCount > 0 && (
              <span aria-hidden="true" className="mr-act-badge mr-num">
                {pendingCount}
              </span>
            )}
          </Chip>
        ))}
      </ChipRow>
      <div className="mr-act-panel">{children}</div>
    </div>
  )
}
