import type { PlayerStats } from '../../../types/api';

export type ViewMode = 'totals' | 'averages';

/** .446 style (the phone design); `value` is a 0–1 fraction. */
export const fraction3 = (value: number) => {
  const s = value.toFixed(3);
  return s.startsWith('0') ? s.slice(1) : s;
};

/**
 * One phone stat value. Percentages come in as 0–1 for players and 0–100 for
 * the aggregated sides (`pctScale`). Counting stats: whole numbers for totals,
 * one decimal per game; GP is always whole.
 */
export function formatMobileStat(field: string, value: number, viewMode: ViewMode, pctScale: 1 | 100 = 1): string {
  if (!Number.isFinite(value)) return '—';
  if (field === 'fg_percentage' || field === 'ft_percentage') return fraction3(value / pctScale);
  if (field === 'gp') return String(Math.round(value));
  if (viewMode === 'totals') return String(Math.round(value));
  return value.toFixed(1);
}

/** Per-game when asked (percentages and GP stay as they are). */
export function displayStats(stats: PlayerStats, viewMode: ViewMode): PlayerStats {
  if (viewMode === 'totals' || stats.gp === 0) return stats;
  const per = (v: number) => v / stats.gp;
  return {
    ...stats,
    pts: per(stats.pts), reb: per(stats.reb), ast: per(stats.ast), stl: per(stats.stl), blk: per(stats.blk),
    fgm: per(stats.fgm), fga: per(stats.fga), ftm: per(stats.ftm), fta: per(stats.fta),
    three_pm: per(stats.three_pm), minutes: per(stats.minutes),
  };
}

/** The 14 stat fields the desktop player card and comparison table show, in order. */
export const STAT_FIELDS: { field: keyof PlayerStats & string; label: string }[] = [
  { field: 'minutes', label: 'MIN' },
  { field: 'fgm', label: 'FGM' },
  { field: 'fga', label: 'FGA' },
  { field: 'fg_percentage', label: 'FG%' },
  { field: 'ftm', label: 'FTM' },
  { field: 'fta', label: 'FTA' },
  { field: 'ft_percentage', label: 'FT%' },
  { field: 'three_pm', label: '3PM' },
  { field: 'reb', label: 'REB' },
  { field: 'ast', label: 'AST' },
  { field: 'stl', label: 'STL' },
  { field: 'blk', label: 'BLK' },
  { field: 'pts', label: 'PTS' },
  { field: 'gp', label: 'GP' },
];
