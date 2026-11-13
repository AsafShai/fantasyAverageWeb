import { useId, useState } from 'react'
import EspnUpdatedNote from '../EspnUpdatedNote'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useTonightGames } from '../../hooks/useTonightGames'
import { formatEspnUpdated } from '../../utils/espnUpdated'
import { liveBadgeText, liveMoment } from '../../utils/live'
import type { LiveBlock } from '../../types/api'

interface LiveBadgeProps {
  live?: LiveBlock | null
  /** Shown instead of the badge when nothing is live (before tip-off, ESPN official). */
  espnUpdatedAt?: string | null
  /** Which side of the badge the sheet opens toward. */
  align?: 'left' | 'right'
  className?: string
}

/**
 * The live badge. While tonight's games are counted (or all final and ESPN not
 * yet official) it replaces the "ESPN updated" note and opens tonight's games on
 * tap. Otherwise it renders that note, exactly as before.
 */
const LiveBadge = ({ live, espnUpdatedAt, align = 'right', className = '' }: LiveBadgeProps) => {
  const moment = liveMoment(live)
  const [open, setOpen] = useState(false)
  const [noSpoilers] = usePersistedState('boxScores.noSpoilers', false)
  const panelId = useId()
  const { games, isLoading } = useTonightGames(open && moment !== null, noSpoilers)

  if (!live || !moment) return <EspnUpdatedNote updatedAt={espnUpdatedAt} className={className} />

  const isLive = moment === 'live'
  const official = live.official_updated_at ? formatEspnUpdated(live.official_updated_at) : null
  const asOf = live.as_of ? new Date(live.as_of).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className={`inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-0.5 text-xs ${
          isLive
            ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
            : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
        }`}
      >
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${isLive ? 'animate-pulse bg-emerald-600' : 'bg-amber-600'}`}
        />
        <span className="font-bold">{isLive ? 'LIVE' : 'FINAL'}</span>
        <span>{liveBadgeText(live)}{isLive && asOf ? ` · updated ${asOf}` : ''}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={panelId}
          className={`absolute top-8 z-20 flex w-72 flex-col gap-2 rounded-lg border border-gray-200 bg-white p-3.5 text-left text-gray-900 shadow-xl dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Tonight's games</div>
          {isLoading && <div className="text-xs text-gray-500 dark:text-gray-400">Loading…</div>}
          {games.map(g => (
            <div key={g.id} className="flex justify-between text-sm">
              <span className="font-medium">{g.name}</span>
              <span className={g.status === 'live' ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}>{g.label}</span>
            </div>
          ))}
          <div className="border-t border-gray-200 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {official ? `ESPN official standings: ${official}. ` : ''}Tonight is added on top until ESPN updates.
          </div>
        </div>
      )}
    </span>
  )
}

export default LiveBadge
