import { describe, expect, it } from 'vitest';
import type { Player } from '../../../../types/api';
import { computePlayerRankings, DEFAULT_CATEGORIES } from '../../../../utils/playerRankings';
import { computePlayerValues, playerValueLookup } from '../playerValues';

// Player i gets a stat line that grows with i, so a higher index is a better player.
const player = (i: number, overrides: Partial<Player> = {}): Player => {
  const gp = 10;
  return {
    player_name: `Player ${i}`,
    player_id: 1000 + i,
    pro_team: 'X',
    positions: ['PG'],
    team_id: 1,
    status: 'ONTEAM',
    stats: {
      pts: (5 + i * 0.1) * gp, reb: (2 + i * 0.03) * gp, ast: (1 + i * 0.02) * gp,
      stl: (0.3 + i * 0.003) * gp, blk: (0.2 + i * 0.002) * gp, three_pm: (0.5 + i * 0.01) * gp,
      fgm: 4 * gp, fga: 9 * gp, fg_percentage: 0.42 + i * 0.0003,
      ftm: 2 * gp, fta: 2.6 * gp, ft_percentage: 0.7 + i * 0.0005,
      minutes: 25 * gp, gp,
    },
    ...overrides,
  };
};

describe('computePlayerValues', () => {
  it('ranks a small league like Player Rankings does, best first', () => {
    const players = Array.from({ length: 50 }, (_, i) => player(i));
    const values = computePlayerValues(players);
    const lookup = playerValueLookup(values);

    const ranked = computePlayerRankings(
      players, { calcMode: 'per_game', minGp: 0, minMin: 0, position: null,
        weights: Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c, 1])) },
    );
    ranked.forEach((r, i) => {
      const value = lookup(r.player)!;
      expect(value.rank).toBe(i + 1);
      expect(value.z).toBeCloseTo(r.totalZ, 10);
      expect(value.of).toBe(50);
    });
    expect(lookup(players[49])!.rank).toBe(1);
    expect(lookup(players[0])!.rank).toBe(50);
  });

  it('ranks players outside the top-300 pool below it, against that pool', () => {
    const players = Array.from({ length: 360 }, (_, i) => player(i));
    const lookup = playerValueLookup(computePlayerValues(players));
    expect(lookup(players[359])!.rank).toBe(1);
    expect(lookup(players[60])!.rank).toBe(300);
    expect(lookup(players[59])!.rank).toBe(301);
    expect(lookup(players[0])!).toMatchObject({ rank: 360, of: 360 });
    expect(lookup(players[0])!.z).toBeLessThan(lookup(players[60])!.z);
  });

  it('leaves out players with no games or no data for the period', () => {
    const players = [
      ...Array.from({ length: 10 }, (_, i) => player(i)),
      player(99, { player_name: 'No Games', player_id: 1, stats: { ...player(0).stats, gp: 0 } }),
      player(98, { player_name: 'No Data', player_id: 2, has_data: false }),
    ];
    const lookup = playerValueLookup(computePlayerValues(players));
    expect(lookup(players[10])).toBeUndefined();
    expect(lookup(players[11])).toBeUndefined();
    expect(lookup(players[9])!.of).toBe(10);
  });

  it('finds a roster player by name when the row has no ESPN id', () => {
    const players = Array.from({ length: 5 }, (_, i) => player(i));
    const lookup = playerValueLookup(computePlayerValues(players));
    expect(lookup({ ...players[4], player_id: null })).toEqual(lookup(players[4]));
    expect(lookup(player(7, { player_name: 'Somebody Else', player_id: 5555 }))).toBeUndefined();
  });

  it('returns nothing for an empty pool', () => {
    expect(computePlayerValues([]).size).toBe(0);
  });
});
