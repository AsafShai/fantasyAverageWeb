import type { Player, PlayerStats } from '../../../types/api';

export interface AggregatedStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg_percentage: number;
  ft_percentage: number;
  three_pm: number;
  minutes: number;
  gp: number;
}

export const calculatePlayerAverages = (stats: PlayerStats): PlayerStats => {
  if (stats.gp === 0) return stats;

  return {
    pts: stats.pts / stats.gp,
    reb: stats.reb / stats.gp,
    ast: stats.ast / stats.gp,
    stl: stats.stl / stats.gp,
    blk: stats.blk / stats.gp,
    fgm: stats.fgm / stats.gp,
    fga: stats.fga / stats.gp,
    ftm: stats.ftm / stats.gp,
    fta: stats.fta / stats.gp,
    fg_percentage: stats.fg_percentage,
    ft_percentage: stats.ft_percentage,
    three_pm: stats.three_pm / stats.gp,
    minutes: stats.minutes / stats.gp,
    gp: stats.gp,
  };
};

export const aggregatePlayerStats = (players: Player[]): AggregatedStats => {
  if (players.length === 0) {
    return {
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      fgm: 0,
      fga: 0,
      ftm: 0,
      fta: 0,
      fg_percentage: 0,
      ft_percentage: 0,
      three_pm: 0,
      minutes: 0,
      gp: 0,
    };
  }

  const totals = players.reduce((acc, player) => {
    const stats = player.stats;
    return {
      pts: acc.pts + stats.pts,
      reb: acc.reb + stats.reb,
      ast: acc.ast + stats.ast,
      stl: acc.stl + stats.stl,
      blk: acc.blk + stats.blk,
      fgm: acc.fgm + stats.fgm,
      fga: acc.fga + stats.fga,
      ftm: acc.ftm + stats.ftm,
      fta: acc.fta + stats.fta,
      three_pm: acc.three_pm + stats.three_pm,
      minutes: acc.minutes + stats.minutes,
      gp: acc.gp + stats.gp,
    };
  }, {
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    fgm: 0,
    fga: 0,
    ftm: 0,
    fta: 0,
    three_pm: 0,
    minutes: 0,
    gp: 0,
  });

  const fg_percentage = totals.fga > 0 ? (totals.fgm / totals.fga) * 100 : 0;
  const ft_percentage = totals.fta > 0 ? (totals.ftm / totals.fta) * 100 : 0;

  return {
    ...totals,
    fg_percentage,
    ft_percentage,
  };
};

export const calculateTeamAverages = (aggregatedStats: AggregatedStats): AggregatedStats => {
  if (aggregatedStats.gp === 0) return aggregatedStats;

  return {
    pts: aggregatedStats.pts / aggregatedStats.gp,
    reb: aggregatedStats.reb / aggregatedStats.gp,
    ast: aggregatedStats.ast / aggregatedStats.gp,
    stl: aggregatedStats.stl / aggregatedStats.gp,
    blk: aggregatedStats.blk / aggregatedStats.gp,
    fgm: aggregatedStats.fgm / aggregatedStats.gp,
    fga: aggregatedStats.fga / aggregatedStats.gp,
    ftm: aggregatedStats.ftm / aggregatedStats.gp,
    fta: aggregatedStats.fta / aggregatedStats.gp,
    fg_percentage: aggregatedStats.fg_percentage,
    ft_percentage: aggregatedStats.ft_percentage,
    three_pm: aggregatedStats.three_pm / aggregatedStats.gp,
    minutes: aggregatedStats.minutes / aggregatedStats.gp,
    gp: aggregatedStats.gp,
  };
};

export const formatStatValue = (
  value: number, 
  isPercentage: boolean = false, 
  viewMode: 'totals' | 'averages' = 'totals'
): string => {
  if (isPercentage) {
    return `${value.toFixed(4)}%`;
  }
  
  if (viewMode === 'totals') {
    return Math.round(value).toString();
  }
  
  return value.toFixed(4);
};

export const getStatColor = (value: number, isPercentage: boolean = false): string => {
  if (isPercentage) {
    if (value >= 80) return 'text-green-600';
    if (value >= 70) return 'text-yellow-600';
    return 'text-red-600';
  }
  
  if (value >= 20) return 'text-green-600';
  if (value >= 10) return 'text-yellow-600';
  return 'text-gray-600';
};