import { describe, expect, it } from 'vitest';
import type { Player } from '../../../../types/api';
import { DEFAULT_CATEGORIES } from '../../../../utils/playerRankings';
import { buildTradeRankingContext } from '../playerValues';
import { tradeShareRows } from '../tradeShare';
import { categoryTone, tradeSideCategoryZs } from '../tradeCategoryZ';
import { rowWinner } from '../../../../components/share/shareCardFormat';

const player = (
  name: string,
  stats: Partial<Player['stats']> & { fgm: number; fga: number; ftm?: number; fta?: number; pts?: number },
): Player => ({
  player_name: name,
  pro_team: 'X',
  positions: ['C'],
  team_id: 1,
  status: 'ONTEAM',
  stats: {
    pts: 20,
    reb: 8,
    ast: 3,
    stl: 1,
    blk: 1,
    ftm: 4,
    fta: 5,
    ft_percentage: 0.8,
    three_pm: 1,
    minutes: 30,
    gp: 10,
    ...stats,
    fg_percentage: stats.fga > 0 ? stats.fgm / stats.fga : 0,
    stats: {
      PTS: 20, REB: 8, AST: 3, STL: 1, BLK: 1, '3PM': 1,
      'FG%': stats.fga > 0 ? stats.fgm / stats.fga : 0,
      'FT%': 0.8,
    },
  },
});

describe('tradeSideCategoryZs', () => {
  it('FG% Z can favor the lower percentage when attempt volume is higher', () => {
    const poolLow = Array.from({ length: 20 }, (_, i) =>
      player(`Low${i}`, { fgm: 4, fga: 10, pts: 10 }),
    );
    const poolHigh = Array.from({ length: 20 }, (_, i) =>
      player(`High${i}`, { fgm: 5, fga: 10, pts: 12 }),
    );
    const pool = [...poolLow, ...poolHigh];
    const { referencePool } = buildTradeRankingContext(pool, DEFAULT_CATEGORIES, new Set());
    const star = [player('Star', { fgm: 17, fga: 25, pts: 28 })];
    const role = [player('Role', { fgm: 62, fga: 120, pts: 18 })];
    const zStar = tradeSideCategoryZs(star, referencePool, DEFAULT_CATEGORIES, new Set(), 'averages');
    const zRole = tradeSideCategoryZs(role, referencePool, DEFAULT_CATEGORIES, new Set(), 'averages');
    expect(zStar && zRole).toBeTruthy();
    const pctStar = 17 / 25;
    const pctRole = 62 / 120;
    expect(pctStar).toBeGreaterThan(pctRole);
    expect(zStar!['FG%']).toBeLessThan(zRole!['FG%']);
    const rows = tradeShareRows(star, role, 'averages', { referencePool, categories: DEFAULT_CATEGORIES, reverseCategories: new Set() });
    const fg = rows.find(r => r.category === 'FG%')!;
    expect(rowWinner(fg)).toBe(1);
  });
});
describe('categoryTone', () => {
  it('calls Zs within 0.05 of each other (as shown) even', () => {
    expect(categoryTone(0.41, 0.36)).toBe('tie');
    expect(categoryTone(0.36, 0.41)).toBe('tie');
    expect(categoryTone(0.35, 0.22)).toBe('win');
    expect(categoryTone(0.22, 0.35)).toBe('lose');
    expect(categoryTone(null, 0.5)).toBe('tie');
  });
});
