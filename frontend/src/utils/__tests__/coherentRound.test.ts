import { describe, expect, it } from 'vitest';
import { coherentInts } from '../coherentRound';
import type { ProjectionStats } from '../../types/api';

function stats(partial: Partial<ProjectionStats>): ProjectionStats {
  return {
    pts: 0, reb: 0, ast: 0, three_pm: 0, stl: 0, blk: 0,
    fgm: 0, fga: 0, fg_pct: 0, ftm: 0, fta: 0, ft_pct: 0,
    ...partial,
  };
}

describe('coherentInts', () => {
  it('keeps the identity PTS = 2*FGM + 3PM + FTM on every result', () => {
    const cases = [
      { pts: 25.1, fgm: 9.0, three_pm: 1.5, ftm: 5.5 },
      { pts: 25.5, fgm: 9.5, three_pm: 1.4, ftm: 5.2 },
      { pts: 0.4, fgm: 0.2, three_pm: 0.0, ftm: 0.1 },
      { pts: 33.7, fgm: 12.1, three_pm: 3.6, ftm: 5.9 },
    ];
    for (const c of cases) {
      const r = coherentInts(stats(c));
      expect(r.pts).toBe(2 * r.fgm + r.three_pm + r.ftm);
    }
  });

  it('PTS reads like a plain round when a component combination allows it', () => {
    // Jokic vs OKC: 25.1 pts / 9.0 fgm / 1.5 3pm / 5.5 ftm.
    // Independent rounding gave 2*9 + 2 + 6 = 26; coherent rounding picks a
    // floor/ceil combo whose total is 25 — the plain round of 25.1.
    const r = coherentInts(stats({ pts: 25.1, fgm: 9.0, three_pm: 1.5, ftm: 5.5 }));
    expect(r.pts).toBe(25);
    expect(r.fgm).toBe(9);
    expect(r.three_pm + r.ftm).toBe(7); // (1,6) or (2,5) — both half-step moves
  });

  it('never moves a component by more than one step from its decimal', () => {
    const r = coherentInts(stats({ pts: 25.5, fgm: 9.5, three_pm: 1.4, ftm: 5.2 }));
    expect(Math.abs(r.fgm - 9.5)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.three_pm - 1.4)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.ftm - 5.2)).toBeLessThanOrEqual(1);
  });

  it('exact integers pass through untouched', () => {
    const r = coherentInts(stats({ pts: 24, fgm: 9, three_pm: 2, ftm: 4 }));
    expect(r).toEqual({ pts: 24, fgm: 9, three_pm: 2, ftm: 4 });
  });
});
