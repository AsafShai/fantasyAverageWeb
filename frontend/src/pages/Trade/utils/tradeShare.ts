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
import {
  formatBundlePct,
  formatMadeAttempted,
  tradeSideCategoryZs,
} from './tradeCategoryZ';
import type { TradeRankingContext } from './playerValues';

// Scoring categories on the share card, mapped to the aggregate fields.
export const SHARE_CATEGORIES = [
  { category: 'FG%', field: 'fg_percentage', label: 'FG%' },
  { category: 'FT%', field: 'ft_percentage', label: 'FT%' },
  { category: '3PM', field: 'three_pm', label: '3PM' },
  { category: 'REB', field: 'reb', label: 'REB' },
  { category: 'AST', field: 'ast', label: 'AST' },
  { category: 'STL', field: 'stl', label: 'STL' },
  { category: 'BLK', field: 'blk', label: 'BLK' },
  { category: 'PTS', field: 'pts', label: 'PTS' },
] as const;

type PlayerKey = Pick<Player, 'player_name' | 'player_id'>;

/** Same player: by ESPN id when both have one, else by name. */
export const samePlayer = (a: PlayerKey, b: PlayerKey) =>
  a.player_id != null && b.player_id != null ? a.player_id === b.player_id : a.player_name === b.player_name;

/** Keys for the desktop / mobile "categories only" column set (composite FG/FT). */
export const SHARE_CATEGORY_FIELDS = [
  'composite:fg',
  'composite:ft',
  ...SHARE_CATEGORIES.slice(2).map(c => c.field),
] as const;

/** Share-card rows, one per scoring category (plus any extra league
 * category): the combined value of `first`, then of `second`. */
export function tradeShareRows(
  first: Player[],
  second: Player[],
  viewMode: 'totals' | 'averages',
  tradeRanking?: TradeRankingContext,
): TradeShareRow[] {
  const aggregate = viewMode === 'averages' ? aggregatePlayerAverages : aggregatePlayerStats;
  const aggregateExtras = viewMode === 'averages' ? aggregateExtraAverages : aggregateExtraTotals;
  const a = aggregate(first);
  const b = aggregate(second);
  const extras = extraCountingCategories([...first, ...second]);
  const extraA = aggregateExtras(first, extras);
  const extraB = aggregateExtras(second, extras);

  const zFirst = tradeRanking?.referencePool.length
    ? tradeSideCategoryZs(first, tradeRanking.referencePool, tradeRanking.categories, tradeRanking.reverseCategories, viewMode)
    : null;
  const zSecond = tradeRanking?.referencePool.length
    ? tradeSideCategoryZs(second, tradeRanking.referencePool, tradeRanking.categories, tradeRanking.reverseCategories, viewMode)
    : null;

  const zPair = (cat: string): [number | null, number | null] | undefined => {
    if (!zFirst || !zSecond) return undefined;
    const left = zFirst[cat as keyof typeof zFirst];
    const right = zSecond[cat as keyof typeof zSecond];
    if (left === undefined || right === undefined) return undefined;
    return [left, right];
  };

  return [
    ...SHARE_CATEGORIES.map(({ category, field, label }): TradeShareRow => {
      const row: TradeShareRow = {
        category: label,
        values: [a[field], b[field]],
        zValues: zPair(category),
      };
      if (category === 'FG%') {
        row.madeAtt = [
          formatMadeAttempted(a.fgm, a.fga, viewMode),
          formatMadeAttempted(b.fgm, b.fga, viewMode),
        ];
        row.pctLine = [formatBundlePct(a.fgm, a.fga), formatBundlePct(b.fgm, b.fga)];
      }
      if (category === 'FT%') {
        row.madeAtt = [
          formatMadeAttempted(a.ftm, a.fta, viewMode),
          formatMadeAttempted(b.ftm, b.fta, viewMode),
        ];
        row.pctLine = [formatBundlePct(a.ftm, a.fta), formatBundlePct(b.ftm, b.fta)];
      }
      return row;
    }),
    ...extras.map((category): TradeShareRow => ({
      category,
      values: [extraA[category], extraB[category]],
      lowerIsBetter: KNOWN_REVERSE_CATEGORIES.has(category),
      zValues: zPair(category),
    })),
  ];
}