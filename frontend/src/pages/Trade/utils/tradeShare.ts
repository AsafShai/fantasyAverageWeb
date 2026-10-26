import type { Player } from '../../../types/api';
import type { TradeShareRow } from '../../../components/share/shareCardFormat';
import {
  aggregatePlayerAverages,
  aggregatePlayerStats,
  aggregateExtraAverages,
  aggregateExtraTotals,
  extraCountingCategories,
  KNOWN_REVERSE_CATEGORIES,
} from './tradeCalculations';

// Scoring categories on the share card, mapped to the aggregate fields.
export const SHARE_CATEGORIES = [
  { category: 'FG%', field: 'fg_percentage' },
  { category: 'FT%', field: 'ft_percentage' },
  { category: '3PM', field: 'three_pm' },
  { category: 'REB', field: 'reb' },
  { category: 'AST', field: 'ast' },
  { category: 'STL', field: 'stl' },
  { category: 'BLK', field: 'blk' },
  { category: 'PTS', field: 'pts' },
] as const;

type PlayerKey = Pick<Player, 'player_name' | 'player_id'>;

/** Same player: by ESPN id when both have one, else by name. */
export const samePlayer = (a: PlayerKey, b: PlayerKey) =>
  a.player_id != null && b.player_id != null ? a.player_id === b.player_id : a.player_name === b.player_name;

/** Share-card rows, one per scoring category (plus any extra league
 * category): the combined value of `first`, then of `second`. */
export function tradeShareRows(first: Player[], second: Player[], viewMode: 'totals' | 'averages'): TradeShareRow[] {
  const aggregate = viewMode === 'averages' ? aggregatePlayerAverages : aggregatePlayerStats;
  const aggregateExtras = viewMode === 'averages' ? aggregateExtraAverages : aggregateExtraTotals;
  const a = aggregate(first);
  const b = aggregate(second);
  const extras = extraCountingCategories([...first, ...second]);
  const extraA = aggregateExtras(first, extras);
  const extraB = aggregateExtras(second, extras);
  return [
    ...SHARE_CATEGORIES.map(({ category, field }): TradeShareRow => ({ category, values: [a[field], b[field]] })),
    ...extras.map((category): TradeShareRow => ({
      category,
      values: [extraA[category], extraB[category]],
      lowerIsBetter: KNOWN_REVERSE_CATEGORIES.has(category),
    })),
  ];
}
