import type { ReactNode } from 'react'
import { Card, Segmented } from '../../ui'
import './analytics.css'

export type EstimatorUrlTab = 'prob' | 'rank' | 'proj'

const TABS: { value: EstimatorUrlTab; label: string }[] = [
  { value: 'prob', label: 'Rank Probability' },
  { value: 'rank', label: 'Projected Rankings' },
  { value: 'proj', label: 'Season Projections' },
]

/**
 * Standings Estimator on a phone: the three sections of the desktop page as
 * tabs (?tab=prob|rank|proj). Each section's state, sorting and share card
 * stay in `pages/Estimator.tsx`; it renders an `EstimatorCard` on a phone.
 */
export function EstimatorMobile({ tab, onTab, children }: { tab: EstimatorUrlTab; onTab: (t: EstimatorUrlTab) => void; children: ReactNode }) {
  return (
    <div className="mr-root mr-es">
      <h1 className="mr-h1">Season Estimator</h1>
      <Segmented label="Season Estimator section" className="mr-an-tabs" options={TABS} value={tab} onChange={onTab} />
      {children}
    </div>
  )
}

export function EstimatorCard({ title, share, explain, children }: { title: string; share?: ReactNode; explain: string; children: ReactNode }) {
  return (
    <Card className="mr-es-card" title={title} action={share ? <div className="mr-es-share">{share}</div> : undefined}>
      <p className="mr-meta mr-es-explain">{explain}</p>
      {children}
    </Card>
  )
}
