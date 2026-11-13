import { FoldTitle } from './FoldTitle'
import { useSectionOpen } from '../hooks/useSectionOpen'
import { useState } from 'react'
import TrendGameLogChart from './TrendGameLogChart'
import type { CustomDateRange, CountingCategory, TimePeriod } from '../types/api'
import { LOW_SAMPLE_GP } from '../utils/trendBaseline'
import { summarize, fmtValue, fmtDelta, type CardMode } from '../utils/playerTrendsSummary'
import { isCountingCategory, isGoodChange } from '../utils/categoryTrends'
import { usePlayerTrends } from '../hooks/usePlayerTrends'

const MODE_LABEL: Partial<Record<CardMode, string>> = { minutes: 'Minutes', usage: 'Usage' }

function Skeleton() {
  return (
    <div className="h-[300px] sm:h-[320px] animate-pulse">
      <div className="h-5 w-40 bg-gray-200 dark:bg-gray-700 rounded mb-4" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />
        ))}
      </div>
      <div className="h-[180px] bg-gray-200 dark:bg-gray-700 rounded-lg" />
    </div>
  )
}

interface Props {
  playerId: number
  /** This league's scoring categories; the counting ones get a row of their own. */
  categories?: string[]
  /** Reverse-scored categories (fewer is better, e.g. TO). */
  reverseCategories?: string[]
  /** The page's time frame; Trends compares that recent stretch to the season. */
  timePeriod?: TimePeriod
  customRange?: CustomDateRange | null
}

export default function PlayerTrendsCard({ playerId, categories, reverseCategories, timePeriod = 'season', customRange = null }: Props) {
  const [open, toggle] = useSectionOpen('trends')
  // which stat's chart is open; clicking the open one again closes it
  const [mode, setMode] = useState<CardMode | null>('minutes')
  const { log, error, is404, isLoading, refetch, windowDays, fallback, availableShootingStats, modes, reverse } =
    usePlayerTrends({ playerId, categories, reverseCategories, timePeriod, customRange })

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-5 sm:p-6 mt-6">
      <h2 className={`text-xl font-bold text-gray-900 dark:text-gray-100 ${open ? 'mb-3' : ''}`}>
        <FoldTitle open={open} onToggle={toggle}>Trends</FoldTitle>
      </h2>
      {open && (<>

      {isLoading && <Skeleton />}

      {!isLoading && error && (
        <div className="h-[300px] sm:h-[320px] flex items-center justify-center text-center px-4">
          {is404 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No game log this season.</p>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Failed to load trends.{' '}
              <button
                type="button"
                onClick={() => refetch()}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {!isLoading && !error && log && (() => {
        const windowGames = log.games.filter((g) => g.game_date >= log.window_start).length
        const partial = windowGames < LOW_SAMPLE_GP
        return (
        <>
          <div className="mb-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Last {windowDays} days vs season · {windowGames} {windowGames === 1 ? 'game' : 'games'}
              {partial && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">partial</span>}
              <span className="hidden sm:inline"> · Click a stat for its game-by-game chart</span>
            </p>
          </div>
          {fallback && (
            <p className="-mt-2 mb-3 text-xs text-gray-400 dark:text-gray-500">
              {fallback === 'season'
                ? 'Full Season has no recent stretch to compare, so Trends shows the last 15 days.'
                : 'Trends compares a stretch that ends on the latest game day, so for this range it shows the last 15 days.'}
            </p>
          )}

          <p className="sm:hidden text-xs text-gray-500 dark:text-gray-400 mb-2">Tap a stat for its game-by-game chart</p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
            {modes.map((key) => {
              const s = summarize(log, key)
              const open = mode === key
              const moved = s.delta !== null && Math.abs(s.delta) >= 0.05
              const good = s.delta !== null && (isCountingCategory(key) ? isGoodChange(s.delta, key, reverse) : s.delta >= 0)
              const deltaClass = !moved
                ? 'text-gray-500 dark:text-gray-400'
                : good
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 font-bold'
                  : 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 font-bold'
              const label = MODE_LABEL[key] ?? key
              return (
                <button
                  key={key}
                  type="button"
                  aria-expanded={open}
                  onClick={() => setMode(open ? null : key)}
                  title={`${label}: season ${fmtValue(s.seasonValue, key)}, last ${windowDays}d ${fmtValue(s.windowValue, key)}. ${open ? 'Click to close the chart' : 'Click for the game-by-game chart'}`}
                  className={`group text-left rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
                    open
                      ? 'border-blue-600 ring-1 ring-blue-600 bg-blue-50/60 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-blue-400 hover:bg-white dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</span>
                    <svg
                      viewBox="0 0 8 10"
                      aria-hidden="true"
                      className={`w-2 h-2.5 transition-transform ${open ? 'rotate-90 text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500 group-hover:text-blue-500'}`}
                    >
                      <path d="M0 0 L8 5 L0 10 Z" fill="currentColor" />
                    </svg>
                  </span>
                  <span className="block text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{fmtValue(s.windowValue, key)}</span>
                  <span className={`inline-block mt-0.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${deltaClass}`}>
                    {fmtDelta(s.delta, key)}
                  </span>
                </button>
              )
            })}
          </div>

          {mode && (
            <TrendGameLogChart
              playerId={playerId}
              playerName={log.player_name}
              mode={mode === 'minutes' || mode === 'usage' ? mode : isCountingCategory(mode) ? 'category' : 'shooting'}
              regressionMode="form"
              windowDays={windowDays}
              baselineSeasons={0}
              stat={mode === 'minutes' || mode === 'usage' || isCountingCategory(mode) ? undefined : mode}
              qualifiedStats={availableShootingStats}
              category={isCountingCategory(mode) ? (mode as CountingCategory) : undefined}
            />
          )}
        </>
        )
      })()}
      </>)}
    </div>
  )
}
