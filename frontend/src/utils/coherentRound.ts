import type { ProjectionStats } from '../types/api';

export interface CoherentInts {
  pts: number;
  fgm: number;
  three_pm: number;
  ftm: number;
  fga: number;
  fta: number;
}

/**
 * Coherent integer rounding for the displayed projection line.
 *
 * Makes (FGM/3PM/FTM) and PTS: the reconciler makes the decimal projections
 * satisfy PTS = 2·FGM + 3PM + FTM exactly, but rounding each stat
 * independently drifts the displayed integers off it by ±1. Instead, try
 * every floor/ceil combination of the three components (8 candidates) and
 * pick the one whose implied total is closest to the decimal PTS, breaking
 * ties by how little the components move. PTS then reads like a plain round
 * whenever possible and the identity always holds on screen.
 *
 * Attempts (FGA/FTA): rounded *conditioned on the chosen makes* — from the
 * candidates around the decimal attempts (never below the makes), pick the
 * one whose implied percentage is closest to the decimal percentage. This
 * prevents untrue fractions like 4.4/5.0 rendering as 5/5 (100%): with FTM
 * pushed to 5, FTA becomes 6 and the line reads 5/6 (83%) ≈ the real 88%.
 */
export function coherentInts(stats: ProjectionStats): CoherentInts {
  let best: { pts: number; fgm: number; three_pm: number; ftm: number } | null = null;
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
  const b = best!;
  return {
    ...b,
    fga: coherentAttempts(b.fgm, stats.fga, stats.fg_pct),
    fta: coherentAttempts(b.ftm, stats.fta, stats.ft_pct),
  };
}

function coherentAttempts(makes: number, att: number, pct: number): number {
  if (makes <= 0) return Math.max(Math.round(att), 0);
  // Candidates around the decimal attempts, plus one above ceil for when the
  // makes were rounded up past the attempts; never below the makes.
  const candidates = Array.from(
    new Set([Math.floor(att), Math.ceil(att), Math.ceil(att) + 1].map((a) => Math.max(a, makes)))
  );
  let best = candidates[0];
  let bestScore = Infinity;
  for (const a of candidates) {
    // Implied-percentage closeness dominates; attempt displacement tie-breaks.
    const score = Math.abs(makes / a - pct) * 10 + Math.abs(a - att) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}
