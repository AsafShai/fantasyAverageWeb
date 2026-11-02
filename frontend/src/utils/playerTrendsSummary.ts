import type { CountingCategory, CustomDateRange, GameLogEntry, GameLogResponse, RegressionStat, TimePeriod } from '../types/api'
import { daysBetween } from './dateRange'
import { CATEGORY_FIELD, isCountingCategory } from './categoryTrends'

export type CardMode = 'minutes' | 'usage' | RegressionStat | CountingCategory

export const STAT_FIELDS: Record<RegressionStat, { made: keyof GameLogEntry; att: keyof GameLogEntry }> = {
  '3P%': { made: 'fg3m', att: 'fg3a' },
  'FT%': { made: 'ftm', att: 'fta' },
  'FG%': { made: 'fgm', att: 'fga' },
}

export function seasonAttempts(games: GameLogEntry[], stat: RegressionStat): number {
  const { att } = STAT_FIELDS[stat]
  return games.reduce((sum, g) => sum + (g[att] as number), 0)
}

export interface TrendSummary {
  seasonValue: number | null
  windowValue: number | null
  delta: number | null
  windowStart: string
  seasonGames: number
  windowGames: number
}

export function summarize(log: GameLogResponse, mode: CardMode): TrendSummary {
  const windowGames = log.games.filter((g) => g.game_date >= log.window_start)

  if (mode === 'minutes' || mode === 'usage') {
    const field: keyof GameLogEntry = mode === 'minutes' ? 'min' : 'usg'
    const seasonValue = mode === 'minutes' ? log.season_mpg : log.season_usg
    const windowValue = windowGames.length
      ? windowGames.reduce((sum, g) => sum + (g[field] as number), 0) / windowGames.length
      : null
    return {
      seasonValue,
      windowValue,
      delta: windowValue === null ? null : windowValue - seasonValue,
      windowStart: log.window_start,
      seasonGames: log.season_gp,
      windowGames: windowGames.length,
    }
  }

  if (isCountingCategory(mode)) {
    const field = CATEGORY_FIELD[mode]
    const mean = (games: GameLogEntry[]) => games.reduce((sum, g) => sum + ((g[field] as number) ?? 0), 0) / games.length
    const seasonValue = log.games.length ? mean(log.games) : null
    const windowValue = windowGames.length ? mean(windowGames) : null
    return {
      seasonValue,
      windowValue,
      delta: windowValue === null || seasonValue === null ? null : windowValue - seasonValue,
      windowStart: log.window_start,
      seasonGames: log.season_gp,
      windowGames: windowGames.length,
    }
  }

  const { made, att } = STAT_FIELDS[mode]
  const seasonValue = log.season_pct[mode] ?? null
  const attSum = windowGames.reduce((sum, g) => sum + (g[att] as number), 0)
  const madeSum = windowGames.reduce((sum, g) => sum + (g[made] as number), 0)
  const windowValue = attSum > 0 ? (madeSum / attSum) * 100 : null
  return {
    seasonValue,
    windowValue,
    delta: windowValue === null || seasonValue === null ? null : windowValue - seasonValue,
    windowStart: log.window_start,
    seasonGames: log.season_gp,
    windowGames: windowGames.length,
  }
}

export function fmtValue(value: number | null, mode: CardMode): string {
  if (value === null) return '—'
  return mode === 'minutes' || isCountingCategory(mode) ? value.toFixed(1) : `${value.toFixed(1)}%`
}


export function fmtDelta(value: number | null, mode: CardMode): string {
  if (value === null) return '—'
  const sign = value >= 0 ? '+' : ''
  return mode === 'minutes' || isCountingCategory(mode) ? `${sign}${value.toFixed(1)}` : `${sign}${value.toFixed(1)}%`
}

export const DEFAULT_TREND_WINDOW_DAYS = 15
const MIN_CUSTOM_WINDOW_DAYS = 5
const MAX_CUSTOM_WINDOW_DAYS = 60
const PERIOD_WINDOW_DAYS: Partial<Record<TimePeriod, number>> = { last_7: 7, last_15: 15, last_30: 30 }

/** The comparison window for the page's time frame. Trends compares a recent
 * stretch ending on the latest game day against the season, so Full Season
 * (nothing to compare) and a custom range ending earlier fall back to 15 days. */
export function trendWindowFor(
  period: TimePeriod,
  range: CustomDateRange | null | undefined,
  anchorIso: string | null,
): { days: number; fallback: null | 'season' | 'custom' } {
  const preset = PERIOD_WINDOW_DAYS[period]
  if (preset) return { days: preset, fallback: null }
  if (period === 'custom' && range && anchorIso && range.end >= anchorIso) {
    const days = daysBetween(range.start, anchorIso)
    if (days >= MIN_CUSTOM_WINDOW_DAYS && days <= MAX_CUSTOM_WINDOW_DAYS) return { days, fallback: null }
  }
  return { days: DEFAULT_TREND_WINDOW_DAYS, fallback: period === 'custom' ? 'custom' : 'season' }
}
