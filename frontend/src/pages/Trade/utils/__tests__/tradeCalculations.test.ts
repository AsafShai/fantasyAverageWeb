import { describe, expect, it } from 'vitest';
import type { Player } from '../../../../types/api';
import {
  aggregatePlayerAverages,
  aggregatePlayerStats,
  calculatePlayerAverages,
  formatStatValue,
  getStatColor,
} from '../tradeCalculations';

const stats = {
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
  ft_percentage: 0.6,
  three_pm: 2,
  minutes: 30,
  gp: 4,
};

describe('calculatePlayerAverages', () => {
  it('divides by gp and preserves percentages', () => {
    const r = calculatePlayerAverages(stats);
    expect(r.pts).toBe(5);
    expect(r.fg_percentage).toBe(0.5);
    expect(r.ft_percentage).toBe(0.6);
  });

  it('gp 0 returns original', () => {
    const r = calculatePlayerAverages({ ...stats, gp: 0 });
    expect(r.pts).toBe(20);
  });
});

describe('aggregatePlayerStats', () => {
  const p1: Player = {
    player_name: 'a',
    pro_team: 'x',
    positions: ['PG'],
    team_id: 1,
    status: 'ONTEAM',
    stats: { ...stats },
  };
  const p2: Player = {
    ...p1,
    player_name: 'b',
    stats: { ...stats, pts: 10, fgm: 2, fga: 4, ftm: 1, fta: 2, gp: 2 },
  };

  it('sums totals and FG/FT% from fgm/fga', () => {
    const a = aggregatePlayerStats([p1, p2]);
    expect(a.pts).toBe(30);
    expect(a.fga).toBe(20);
    expect(a.fgm).toBe(10);
    expect(a.fg_percentage).toBe(50);
  });

  it('empty returns zeros', () => {
    const a = aggregatePlayerStats([]);
    expect(a.pts).toBe(0);
  });
});

describe('aggregatePlayerAverages (trade)', () => {
  const p: Player = {
    player_name: 'a',
    pro_team: 'x',
    positions: ['PG'],
    team_id: 1,
    status: 'ONTEAM',
    stats: { ...stats },
  };

  it('scales fg/ft percentages by 100 vs statsUtils', () => {
    const a = aggregatePlayerAverages([p]);
    expect(a.fg_percentage).toBeGreaterThan(1);
    expect(a.ft_percentage).toBeGreaterThan(1);
  });
});

describe('formatStatValue', () => {
  it('percentage with isFromBackend', () => {
    expect(formatStatValue(0.5, true, 'averages', true)).toBe('50.000%');
  });

  it('totals vs averages', () => {
    expect(formatStatValue(12.3, false, 'totals')).toBe('12');
    expect(formatStatValue(12.3, false, 'averages')).toBe('12.300');
  });
});

describe('getStatColor', () => {
  it('percentage thresholds', () => {
    expect(getStatColor(85, true)).toContain('green');
    expect(getStatColor(75, true)).toContain('yellow');
    expect(getStatColor(50, true)).toContain('red');
  });

  it('raw stat thresholds', () => {
    expect(getStatColor(25, false)).toContain('green');
    expect(getStatColor(15, false)).toContain('yellow');
  });
});
