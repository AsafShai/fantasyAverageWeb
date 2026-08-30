import { useEffect } from 'react'
import PlayerIdentityCell from './PlayerIdentityCell'
import {
  SITE_LABEL,
  adpDeltaClass,
  blendValue,
  formatAdp,
  siteValue,
  spreadValue,
  type AdpSiteKey,
} from '../../utils/adp'
import type { AdpMetric, AdpPlayer } from '../../types/api'

function Tile({
  label,
  value,
  sub,
  className = '',
}: {
  label: string
  value: string
  sub?: string | null
  className?: string
}) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/80 px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold tabular-nums ${className}`}>{value}</div>
      {sub ? <div className="text-[10px] text-gray-400 font-normal">#{sub}</div> : null}
    </div>
  )
}

export default function AdpPlayerSheet({
  player,
  metric,
  sites,
  onClose,
}: {
  player: AdpPlayer
  metric: AdpMetric
  sites: AdpSiteKey[]
  onClose: () => void
}) {
  const blend = blendValue(player, metric)
  const blendRank = metric === 'adp' ? player.blend_rank : player.ranking_blend_rank

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
        aria-labelledby="adp-player-sheet-title"
        className="w-full max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-gray-900 shadow-xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="adp-player-sheet-title" className="sr-only">
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
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">#</div>
            <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {blendRank ?? '—'}
            </div>
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
            {metric === 'adp' ? 'ADP' : 'Rankings'}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Blend" value={formatAdp(blend)} sub={blendRank != null ? String(blendRank) : null} />
            <Tile label="Spread" value={formatAdp(spreadValue(player, metric))} />
            {sites.map((site) => {
              const value = siteValue(player, site, metric)
              return (
                <Tile
                  key={site}
                  label={SITE_LABEL[site]}
                  value={formatAdp(value)}
                  sub={metric === 'adp' && player[site].rank != null ? String(player[site].rank) : null}
                  className={adpDeltaClass(value, blend)}
                />
              )
            })}
          </div>
        </section>

        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          Site colors compare that site to Blend.{' '}
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">Green</span> is higher than Blend;{' '}
          <span className="text-rose-600 dark:text-rose-400 font-medium">red</span> is lower. Stronger color is a
          bigger gap (4+ places).
        </p>
      </div>
    </div>
  )
}
