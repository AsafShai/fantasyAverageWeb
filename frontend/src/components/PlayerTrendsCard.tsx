import { useMemo, useState } from 'react'
import { useGetTrendGameLogQuery } from '../store/api/fantasyApi'
import TrendGameLogChart from './TrendGameLogChart'
import DateRangePicker from './DateRangePicker'
import type { RegressionStat, CustomDateRange, CountingCategory } from '../types/api'
import { LOW_SAMPLE_GP } from '../utils/trendBaseline'
import { toLocalIso, daysBetween, formatShort } from '../utils/dateRange'
import { STAT_FIELDS, seasonAttempts, summarize, fmtValue, fmtDelta, type CardMode } from '../utils/playerTrendsSummary'
import { countingCategoriesOf, isCountingCategory, isGoodChange } from '../utils/categoryTrends'
import { orderCategories } from '../utils/statOrder'

const DEFAULT_WINDOW_DAYS = 15
const PRESET_WINDOWS = [7, 15, 30] as const
const MIN_CUSTOM_WINDOW_DAYS = 5
const MAX_CUSTOM_WINDOW_DAYS = 60

const MODE_LABEL: Partial<Record<CardMode, string>> = { minutes: 'Minutes', usage: 'Usage' }

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toLocalIso(dt)
}

function subDaysIso(iso: string, days: number): string {
  return addDaysIso(iso, -days)
}

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
}

export default function PlayerTrendsCard({ playerId, categories, reverseCategories }: Props) {
  const countingCats = useMemo(() => countingCategoriesOf(categories), [categories])
  const reverse = useMemo(() => new Set(reverseCategories ?? []), [reverseCategories])
  // which stat's chart is open; clicking the open one again closes it
  const [mode, setMode] = useState<CardMode | null>('minutes')
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS)
  const [customStartIso, setCustomStartIso] = useState<string | null>(null)
  const [customOpen, setCustomOpen] = useState(false)
  const [customError, setCustomError] = useState<string | null>(null)

  const { data: log, error, isLoading, refetch } = useGetTrendGameLogQuery(
    { playerId, windowDays, baselineSeasons: 0, mode: 'form' },
    { skip: !playerId, refetchOnFocus: false },
  )

  const availableShootingStats = useMemo(() => {
    if (!log) return []
    return (Object.keys(STAT_FIELDS) as RegressionStat[]).filter((s) => seasonAttempts(log.games, s) > 0)
  }, [log])

  // one grid, in the app's stat order: role first, then the league's
  // percentages and counting categories as on every other table
  const modes = useMemo<CardMode[]>(
    () => ['minutes', 'usage', ...orderCategories<CardMode>([...availableShootingStats, ...countingCats])],
    [availableShootingStats, countingCats],
  )

  // anchor (latest game day) is invariant across windows, so any loaded
  // response - whichever window it was fetched for - can derive it
  const anchorIso = log ? addDaysIso(log.window_start, log.window_days) : null
  const customMinStartIso = anchorIso ? subDaysIso(anchorIso, MAX_CUSTOM_WINDOW_DAYS) : undefined

  const selectPreset = (d: number) => {
    setWindowDays(d)
    setCustomStartIso(null)
    setCustomError(null)
    setCustomOpen(false)
  }

  const handleCustomApply = (range: CustomDateRange) => {
    if (!anchorIso) return
    const days = daysBetween(range.start, anchorIso)
    if (days < MIN_CUSTOM_WINDOW_DAYS || days > MAX_CUSTOM_WINDOW_DAYS) {
      setCustomError(`That's ${days} day${days === 1 ? '' : 's'} — pick a start between ${MIN_CUSTOM_WINDOW_DAYS} and ${MAX_CUSTOM_WINDOW_DAYS} days before ${formatShort(anchorIso)}.`)
      return
    }
    setCustomError(null)
    setCustomStartIso(range.start)
    setWindowDays(days)
    setCustomOpen(false)
  }

  const is404 = error && 'status' in error && error.status === 404

  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-5 sm:p-6 mt-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-3">Trends</h2>

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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 order-2 sm:order-1">
              Last {windowDays} days vs season · {windowGames} {windowGames === 1 ? 'game' : 'games'}
              {partial && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">partial</span>}
              <span className="hidden sm:inline"> · Click a stat for its game-by-game chart</span>
            </p>

            <div className="flex flex-wrap items-center gap-2 order-1 sm:order-2">
              <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs">
                {PRESET_WINDOWS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => selectPreset(d)}
                    className={`px-2.5 py-1.5 whitespace-nowrap ${!customStartIso && windowDays === d ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                  >
                    {d}d
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setCustomOpen((o) => !o)}
                  title="Pick a custom start date — the window always ends on the latest game day"
                  className={`px-2.5 py-1.5 whitespace-nowrap ${customStartIso ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                >
                  📆
                </button>
              </div>
              {customStartIso && !customOpen && (
                <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  since {formatShort(customStartIso)} · {windowDays}d
                </span>
              )}
            </div>
          </div>

          {customOpen && anchorIso && (
            <div className="mb-3">
              <DateRangePicker
                seasonStart={customMinStartIso}
                fixedEnd={anchorIso}
                initialStart={customStartIso ?? ''}
                onApply={handleCustomApply}
              />
              {customError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {customError}</p>}
            </div>
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
    </div>
  )
}
