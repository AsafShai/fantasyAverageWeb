import type { Player, StatFilter } from '../types/api'

const isPercentageStat = (stat: StatFilter['stat']) => stat === 'fg_percentage' || stat === 'ft_percentage'

/** The number typed in the filter's value box, or null when it is not one
 * (an empty box parses to NaN, and a NaN filter would hide every player). */
export function parseStatFilterValue(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function decimalsOf(value: number): number {
  const text = String(value)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * Whether a player passes one stat filter. Percentages are typed 0-100 and
 * counting stats follow the per-game / totals toggle. "=" matches at the
 * precision typed: a per-game average is never exactly 20, so "PTS = 20"
 * means it rounds to 20 and "= 20.5" means it rounds to 20.5.
 */
export function passesStatFilter(player: Player, filter: StatFilter, showAverages: boolean): boolean {
  const statValue = player.stats[filter.stat]
  const isPercentage = isPercentageStat(filter.stat)
  const perGame = showAverages && !isPercentage
  const raw = perGame ? (player.stats.gp > 0 ? statValue / player.stats.gp : 0) : statValue
  const value = isPercentage ? raw * 100 : raw

  switch (filter.operator) {
    case 'eq': {
      const factor = 10 ** decimalsOf(filter.value)
      return Math.round(value * factor) === Math.round(filter.value * factor)
    }
    case 'gt': return value > filter.value
    case 'lt': return value < filter.value
    case 'gte': return value >= filter.value
    case 'lte': return value <= filter.value
  }
}
