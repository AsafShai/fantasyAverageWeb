import type { GameLogEntry, GameLogResponse, RegressionStat } from '../types/api'

export type CardMode = 'minutes' | 'usage' | RegressionStat

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
  return mode === 'minutes' ? value.toFixed(1) : `${value.toFixed(1)}%`
}

export function fmtDelta(value: number | null, mode: CardMode): string {
  if (value === null) return '—'
  const sign = value >= 0 ? '+' : ''
  return mode === 'minutes' ? `${sign}${value.toFixed(1)}` : `${sign}${value.toFixed(1)}%`
}
