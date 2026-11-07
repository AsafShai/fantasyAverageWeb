import { useMemo } from 'react'
import { useGetTrendGameLogQuery } from '../store/api/fantasyApi'
import type { RegressionStat, CustomDateRange, TimePeriod } from '../types/api'
import { toLocalIso } from '../utils/dateRange'
import { STAT_FIELDS, seasonAttempts, trendWindowFor, DEFAULT_TREND_WINDOW_DAYS, type CardMode } from '../utils/playerTrendsSummary'
import { countingCategoriesOf } from '../utils/categoryTrends'
import { orderCategories } from '../utils/statOrder'

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return toLocalIso(dt)
}

interface Args {
  playerId: number
  /** This league's scoring categories; the counting ones get a tile of their own. */
  categories?: string[]
  /** Reverse-scored categories (fewer is better, e.g. TO). */
  reverseCategories?: string[]
  /** The page's time frame; Trends compares that recent stretch to the season. */
  timePeriod?: TimePeriod
  customRange?: CustomDateRange | null
}

/**
 * Data behind the profile's Trends card (desktop and phone): the game log for
 * the window that follows the page's time frame, and the stats to show tiles
 * for, in the app's stat order.
 */
export function usePlayerTrends({ playerId, categories, reverseCategories, timePeriod = 'season', customRange = null }: Args) {
  const countingCats = useMemo(() => countingCategoriesOf(categories), [categories])
  const reverse = useMemo(() => new Set(reverseCategories ?? []), [reverseCategories])
  // A custom range needs the latest game day to tell whether it ends there.
  // It doesn't depend on the window, so read it off the default 15-day log
  // (the same cached request the fallback uses); other time frames skip this.
  const { data: anchorLog } = useGetTrendGameLogQuery(
    { playerId, windowDays: DEFAULT_TREND_WINDOW_DAYS, baselineSeasons: 0, mode: 'form' },
    { skip: !playerId || timePeriod !== 'custom', refetchOnFocus: false },
  )
  const anchorIso = anchorLog ? addDaysIso(anchorLog.window_start, anchorLog.window_days) : null
  const { days: windowDays, fallback } = trendWindowFor(timePeriod, customRange, anchorIso)

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

  const is404 = !!error && 'status' in error && error.status === 404

  return { log, error, is404, isLoading, refetch, windowDays, fallback, availableShootingStats, modes, reverse }
}
