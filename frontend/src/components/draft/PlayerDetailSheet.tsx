import { useEffect } from 'react'
import PlayerIdentityCell from './PlayerIdentityCell'
import { LAST_YEAR_COLS, formatAdp, formatLastYearStat } from '../../utils/adp'
import type { AdpPlayer, LastYearStats } from '../../types/api'

function signedDelta(rank: number, compareRank: number | null): { text: string; className: string } {
  if (compareRank == null) return { text: '—', className: 'text-gray-400' }
  const delta = rank - compareRank
  if (delta < 0) return { text: String(delta), className: 'text-emerald-600 dark:text-emerald-400' }
  if (delta > 0) return { text: `+${delta}`, className: 'text-rose-600 dark:text-rose-400' }
  return { text: '0', className: 'text-gray-400' }
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/80 px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{value}</div>
    </div>
  )
}

export default function PlayerDetailSheet({
  player,
  rank,
  lastRank,
  stats,
  statsLabel,
  dirty,
  onClose,
  onMoveUp,
  onMoveDown,
  onMoveTo,
  onSave,
}: {
  player: AdpPlayer
  rank: number
  lastRank: number | null
  stats?: LastYearStats | null
  statsLabel?: string | null
  dirty: boolean
  onClose: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onMoveTo: () => void
  onSave: () => void
}) {
  const vsBlend = signedDelta(rank, player.blend_rank)
  const vsLast = signedDelta(rank, lastRank)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-sheet-title"
        className="w-full max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-gray-900 shadow-xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="player-sheet-title" className="sr-only">
              {player.name}
            </h2>
            <PlayerIdentityCell
              name={player.name}
              playerId={player.espn_id}
              photoUrl={player.photo_url}
              teamAbbr={player.team_abbr}
              positions={player.positions}
              wrapName
              photoSize="full"
            />
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Rank</div>
            <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{rank || '—'}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 -mr-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
            {statsLabel || 'Stats'}
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {LAST_YEAR_COLS.map((col) => (
              <StatTile
                key={col.key}
                label={col.label}
                value={stats ? formatLastYearStat(stats[col.key], col.pct, col.whole) : '—'}
              />
            ))}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Rankings</h3>
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Blend ranking</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums">{player.blend_rank ?? '—'}</dd>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Blend ADP</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatAdp(player.blend)}</dd>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Δ vs Blend</dt>
              <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${vsBlend.className}`}>{vsBlend.text}</dd>
            </div>
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Δ vs Last Rankings</dt>
              <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${vsLast.className}`}>{vsLast.text}</dd>
            </div>
          </dl>
        </section>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onMoveUp}
            className="px-3 py-2.5 text-sm font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            ↑ Up
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            className="px-3 py-2.5 text-sm font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            ↓ Down
          </button>
          <button
            type="button"
            onClick={onMoveTo}
            className="px-3 py-2.5 text-sm font-semibold rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            Move to
          </button>
        </div>
        {dirty ? (
          <button type="button" onClick={onSave} className="btn-primary w-full mt-2 py-2.5 text-sm">
            Save rankings
          </button>
        ) : null}
      </div>
    </div>
  )
}
