import type { Player } from '../types/api';

export interface PlayerAverages {
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

export const aggregatePlayerAverages = (players: Player[]): PlayerAverages => {
  if (players.length === 0) {
    return { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, fg_percentage: 0, ft_percentage: 0, three_pm: 0, minutes: 0, gp: 0 };
  }

  const n = players.length;
  const avg = (getter: (p: Player) => number) =>
    players.reduce((s, p) => s + getter(p), 0) / n;
  const perGame = (stat: (p: Player) => number) =>
    avg(p => p.stats.gp > 0 ? stat(p) / p.stats.gp : 0);

  const fgm = perGame(p => p.stats.fgm);
  const fga = perGame(p => p.stats.fga);
  const ftm = perGame(p => p.stats.ftm);
  const fta = perGame(p => p.stats.fta);

  return {
    pts: perGame(p => p.stats.pts),
    reb: perGame(p => p.stats.reb),
    ast: perGame(p => p.stats.ast),
    stl: perGame(p => p.stats.stl),
    blk: perGame(p => p.stats.blk),
    fgm,
    fga,
    ftm,
    fta,
    fg_percentage: fga > 0 ? fgm / fga : 0,
    ft_percentage: fta > 0 ? ftm / fta : 0,
    three_pm: perGame(p => p.stats.three_pm),
    minutes: perGame(p => p.stats.minutes),
    gp: players.reduce((s, p) => s + p.stats.gp, 0),
  };
};
