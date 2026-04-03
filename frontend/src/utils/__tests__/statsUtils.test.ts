import { describe, expect, it } from 'vitest';
import type { Player } from '../../types/api';
import { aggregatePlayerAverages } from '../statsUtils';

const baseStats = {
  pts: 20,
  reb: 10,
  ast: 5,
  stl: 1,
  blk: 1,
  fgm: 8,
  fga: 16,
  ftm: 4,
  fta: 5,
  fg_percentage: 0.5,
  ft_percentage: 0.8,
  three_pm: 2,
  minutes: 30,
  gp: 10,
};

function pl(overrides: Partial<Player['stats']> = {}): Player {
  return {
    player_name: 'P',
    pro_team: 'T',
    positions: ['PG'],
    team_id: 1,
    status: 'ONTEAM',
    stats: { ...baseStats, ...overrides },
  };
}

describe('aggregatePlayerAverages', () => {
  it('computes per-game aggregates and FG/FT% from totals', () => {
    const a = aggregatePlayerAverages([pl(), pl({ pts: 10, fgm: 2, fga: 4, ftm: 1, fta: 2, gp: 10 })]);
    expect(a.pts).toBeCloseTo(1.5, 5);
    expect(a.fgm).toBeCloseTo(0.5, 5);
    expect(a.fga).toBeCloseTo(1.0, 5);
    expect(a.fg_percentage).toBeCloseTo(0.5, 5);
    expect(a.ft_percentage).toBeCloseTo(0.25 / 0.35, 5);
  });

  it('returns zeros for empty list', () => {
    const z = aggregatePlayerAverages([]);
    expect(z.pts).toBe(0);
    expect(z.gp).toBe(0);
  });

  it('player with gp 0 contributes 0 to per-game parts but sums gp', () => {
    const a = aggregatePlayerAverages([pl({ gp: 0, pts: 999 })]);
    expect(a.gp).toBe(0);
    expect(a.pts).toBe(0);
  });
});
