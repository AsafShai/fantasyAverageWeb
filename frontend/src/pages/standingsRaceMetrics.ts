import type { TeamTimeSeriesPoint } from '../types/api'
import { orderCategories } from '../utils/statOrder'

export type MetricOption = { value: string; label: string }

export const TOTAL_METRIC = 'rk_total'

// Categories that have a dedicated rk_* field, mirroring the backend's
// _RANKINGS_COL_MAP. Anything the league scores beyond these arrives in `ranks`.
const RK_FIELD_BY_CATEGORY: Record<string, keyof TeamTimeSeriesPoint> = {
  PTS: 'rk_pts',
  REB: 'rk_reb',
  AST: 'rk_ast',
  STL: 'rk_stl',
  BLK: 'rk_blk',
  '3PM': 'rk_three_pm',
  'FG%': 'rk_fg_pct',
  'FT%': 'rk_ft_pct',
}

const FIXED_CATEGORY_ORDER = orderCategories(Object.keys(RK_FIELD_BY_CATEGORY))

// A category's rank comes from `ranks` when the league scores something without
// a field of its own, and from the rk_* field otherwise. rk_total is never read
// from `ranks`: the backend has already overridden it with the all-category
// total when there is one, since rk_total alone means "total over the fixed
// categories" and would under-count a league scoring more.
export const rankValue = (point: TeamTimeSeriesPoint, metric: string): number => {
  if (metric === TOTAL_METRIC) return point.rk_total ?? NaN
  const fromRanks = point.ranks?.[metric]
  if (fromRanks !== undefined && fromRanks !== null) return Number(fromRanks)
  const field = RK_FIELD_BY_CATEGORY[metric]
  const value = field ? point[field] : undefined
  return value === undefined || value === null ? NaN : Number(value)
}

// The league's actual categories, not a fixed list: `ranks` carries every
// category once the league scores anything without an rk_* field. Familiar
// ordering first, then whatever else the payload adds.
export const metricOptionsFor = (points: TeamTimeSeriesPoint[] | undefined): MetricOption[] => {
  const fromRanks = new Set<string>()
  points?.forEach(p => {
    if (p.ranks) Object.keys(p.ranks).forEach(c => fromRanks.add(c))
  })
  const categories = fromRanks.size > 0
    ? orderCategories(Array.from(fromRanks))
    : FIXED_CATEGORY_ORDER
  return [
    { value: TOTAL_METRIC, label: 'Total' },
    ...categories.map(c => ({ value: c, label: c })),
  ]
}

// --- Stat Value view: the teams' actual numbers rather than roto ranks ---

export type Basis = 'avg' | 'totals'

// Counting stats a snapshot stores only as inputs to a percentage. They are not
// scored categories, so the fallback list (no league settings) leaves them out.
const SOURCE_ONLY_STATS = new Set(['FGM', 'FGA', 'FTM', 'FTA', '3PA', 'GP'])

export const statValue = (point: TeamTimeSeriesPoint, metric: string): number => {
  const value = point.values?.[metric]
  return value === undefined || value === null ? NaN : Number(value)
}

// The league's scored categories that the payload actually carries values for,
// in the league's order. Without league settings, every carried category that
// is not just a percentage's input, in the familiar order.
export const statMetricOptionsFor = (
  points: TeamTimeSeriesPoint[] | undefined,
  leagueCategories: string[] | undefined,
): MetricOption[] => {
  const carried = new Set<string>()
  points?.forEach(p => {
    if (p.values) Object.keys(p.values).forEach(c => carried.add(c))
  })
  const categories = leagueCategories && leagueCategories.length > 0
    ? orderCategories(leagueCategories.filter(c => carried.has(c)))
    : orderCategories(Array.from(carried).filter(c => !SOURCE_ONLY_STATS.has(c)))
  return categories.map(c => ({ value: c, label: c }))
}

export const isPercentCategory = (metric: string) => metric.includes('%')

// .472 for a percentage; 14.2 or 0.95 per game; 2,840 for a season total
// (a derived rate such as A/TO stays at two decimals in either basis).
export const formatStatValue = (value: number, metric: string, basis: Basis): string => {
  if (isPercentCategory(metric)) return value.toFixed(3).replace(/^(-?)0\./, '$1.')
  if (basis === 'totals' && Number.isInteger(value)) return value.toLocaleString()
  if (basis === 'avg' && Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2)
}
