import type { ProjectionStats } from '../types/api';

export interface CoherentInts {
  pts: number;
  fgm: number;
  three_pm: number;
  ftm: number;
}

/**
 * Coherent integer rounding for the scoring identity PTS = 2·FGM + 3PM + FTM.
 *
 * The reconciler makes the decimal projections satisfy the identity exactly;
 * rounding each stat independently can then drift the displayed integers off
 * it by ±1. Instead, try every floor/ceil combination of the three components
 * (8 candidates) and pick the one whose implied points total is closest to the
 * decimal PTS, breaking ties by how little the components themselves move.
 * The result: PTS reads like a plain round of the decimal whenever possible,
 * and 2·FGM + 3PM + FTM always equals the displayed PTS.
 */
export function coherentInts(stats: ProjectionStats): CoherentInts {
  let best: CoherentInts | null = null;
  let bestScore = Infinity;
  for (const fgm of [Math.floor(stats.fgm), Math.ceil(stats.fgm)]) {
    for (const three of [Math.floor(stats.three_pm), Math.ceil(stats.three_pm)]) {
      for (const ftm of [Math.floor(stats.ftm), Math.ceil(stats.ftm)]) {
        const pts = 2 * fgm + three + ftm;
        // Distance of the implied total from the decimal PTS dominates;
        // component displacement is the tie-breaker.
        const score =
          Math.abs(pts - stats.pts) * 10 +
          Math.abs(fgm - stats.fgm) +
          Math.abs(three - stats.three_pm) +
          Math.abs(ftm - stats.ftm);
        if (score < bestScore) {
          bestScore = score;
          best = { pts, fgm, three_pm: three, ftm };
        }
      }
    }
  }
  return best!;
}
