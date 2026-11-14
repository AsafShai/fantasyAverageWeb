import type { Player } from '../../../types/api';
import {
  categoryZAgainstPool,
  type RankingCategory,
} from '../../../utils/playerRankings';
import type { AggregatedStats } from './tradeCalculations';
import {
  aggregateExtraAverages,
  aggregateExtraTotals,
  aggregatePlayerAverages,
  aggregatePlayerStats,
  extraCountingCategories,
} from './tradeCalculations';

export const COMPOSITE_FG = 'composite:fg';
export const COMPOSITE_FT = 'composite:ft';

/** Fixed stat column → league category code. */
export const COLUMN_TO_CATEGORY: Record<string, RankingCategory> = {
  fg_percentage: 'FG%',
  ft_percentage: 'FT%',
  three_pm: '3PM',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  pts: 'PTS',
};

export function viewModeToCalcMode(viewMode: 'totals' | 'averages'): 'totals' | 'per_game' {
  return viewMode === 'averages' ? 'per_game' : 'totals';
}

export function categoryOnlyColumnKeys(extraCategories: string[]): string[] {
  return [
    COMPOSITE_FG,
    COMPOSITE_FT,
    'three_pm',
    'reb',
    'ast',
    'stl',
    'blk',
    'pts',
    ...extraCategories.map(c => `extra:${c}`),
  ];
}

function bundlePlayerFromAggregate(
  agg: AggregatedStats,
  extraStats: Record<string, number>,
  viewMode: 'totals' | 'averages',
): Player {
  const fgPct = agg.fga > 0 ? agg.fgm / agg.fga : 0;
  const ftPct = agg.fta > 0 ? agg.ftm / agg.fta : 0;
  // Averages view stores per-game rates in agg; gp=1 so categoryZAgainstPool
  // matches Player Rankings per_game (attempts = fga/gp, counting stats = per game).
  const gp = viewMode === 'averages' ? 1 : Math.max(agg.gp, 1);
  const statsDict: Record<string, number> = {
    PTS: agg.pts,
    REB: agg.reb,
    AST: agg.ast,
    STL: agg.stl,
    BLK: agg.blk,
    '3PM': agg.three_pm,
    'FG%': fgPct,
    'FT%': ftPct,
    ...extraStats,
  };
  return {
    player_name: '__trade_bundle__',
    pro_team: '',
    positions: ['G'],
    team_id: 0,
    status: 'ONTEAM',
    stats: {
      pts: agg.pts,
      reb: agg.reb,
      ast: agg.ast,
      stl: agg.stl,
      blk: agg.blk,
      fgm: agg.fgm,
      fga: agg.fga,
      ftm: agg.ftm,
      fta: agg.fta,
      fg_percentage: fgPct,
      ft_percentage: ftPct,
      three_pm: agg.three_pm,
      minutes: agg.minutes,
      gp,
      stats: statsDict,
    },
  };
}

/** One synthetic player line for the combined stats of everyone on a trade side. */
export function aggregatedBundlePlayer(players: Player[], viewMode: 'totals' | 'averages'): Player {
  const extraCategories = extraCountingCategories(players);
  const agg = viewMode === 'averages' ? aggregatePlayerAverages(players) : aggregatePlayerStats(players);
  const extraStats = viewMode === 'averages'
    ? aggregateExtraAverages(players, extraCategories)
    : aggregateExtraTotals(players, extraCategories);
  return bundlePlayerFromAggregate(agg, extraStats, viewMode);
}

/** Per-category z for a trade side's bundle, scored like Player Rankings. */
export function tradeSideCategoryZs(
  players: Player[],
  referencePool: Player[],
  categories: RankingCategory[],
  reverseCategories: Set<RankingCategory>,
  viewMode: 'totals' | 'averages',
): Record<RankingCategory, number> | null {
  if (referencePool.length === 0 || players.length === 0) return null;
  const synthetic = aggregatedBundlePlayer(players, viewMode);
  return categoryZAgainstPool(
    synthetic,
    referencePool,
    viewModeToCalcMode(viewMode),
    categories,
    reverseCategories,
  );
}

export function formatMadeAttempted(made: number, att: number, viewMode: 'totals' | 'averages'): string {
  if (viewMode === 'averages') return `${made.toFixed(1)}-${att.toFixed(1)}`;
  return `${Math.round(made)}-${Math.round(att)}`;
}

export function formatBundlePct(made: number, att: number): string {
  if (att <= 0) return '—';
  return `${((100 * made) / att).toFixed(1)}%`;
}

export const signedCategoryZ = (z: number) => `${z >= 0 ? '+' : ''}${z.toFixed(2)}`;

export type CategoryTone = 'win' | 'lose' | 'tie';

export function categoryTone(myZ: number | null | undefined, otherZ: number | null | undefined): CategoryTone {
  if (myZ == null || otherZ == null || myZ === otherZ) return 'tie';
  return myZ > otherZ ? 'win' : 'lose';
}