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
