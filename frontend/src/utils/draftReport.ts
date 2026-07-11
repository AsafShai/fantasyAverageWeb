import type { Player, DraftPick } from '../types/api'
import {
  computePlayerRankings,
  scoreAgainstPool,
  partitionByDataAvailability,
  CATEGORIES,
  type RankingCategory,
} from './playerRankings'

export type DraftBadge = 'Steal' | 'Solid' | 'Fair' | 'Reach' | 'Bust' | 'INJ' | 'DNP'

export interface ScoredPick extends DraftPick {
  gp: number | null
  mpg: number | null
  totalZ: number | null
  valueRank: number | null
  diff: number | null
  badge: DraftBadge
}

export interface TeamGrade {
  team_id: number
  team_name: string
  avgDiff: number
  zSum: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

const MIN_GP_FOR_RANK = 15
const STEAL_MIN_GP = 50
const WEIGHTS = Object.fromEntries(CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

function badgeFor(diff: number): DraftBadge {
  if (diff >= 25) return 'Steal'
  if (diff >= 10) return 'Solid'
  if (diff > -10) return 'Fair'
  if (diff > -25) return 'Reach'
  return 'Bust'
}

export function buildScoredPicks(picks: DraftPick[], allPlayers: Player[], calcMode: 'totals' | 'per_game'): ScoredPick[] {
  const { available } = partitionByDataAvailability(allPlayers)
  // computePlayerRankings caps its returned pool at 300 (a display-perf limit
  // for the interactive Player Rankings page) — draft report needs every
  // qualified (GP >= MIN_GP_FOR_RANK) player ranked, not just the top 300, so
  // it re-scores anyone the cap dropped against the same referencePool and
  // re-sorts the full qualified set itself.
  const ranked = computePlayerRankings(available, { calcMode, minGp: MIN_GP_FOR_RANK, minMin: 0, position: null, weights: WEIGHTS })
  const referencePool = ranked.map(r => r.player)
  const zByName = new Map(ranked.map(r => [r.player.player_name, r.totalZ]))

  const qualified = available.filter(p => p.stats.gp >= MIN_GP_FOR_RANK)
  const fullyRanked = qualified
    .map(p => ({ player: p, totalZ: zByName.get(p.player_name) ?? scoreAgainstPool(p, referencePool, calcMode, WEIGHTS) }))
    .sort((a, b) => b.totalZ - a.totalZ)
  const rankByName = new Map(fullyRanked.map((r, i) => [r.player.player_name, { rank: i + 1, totalZ: r.totalZ }]))

  const playerByName = new Map(available.map(p => [p.player_name, p]))
  const fallbackRank = available.length + 40

  return picks.map(pick => {
    const rankedEntry = rankByName.get(pick.player_name)
    if (rankedEntry) {
      const diff = pick.pick - rankedEntry.rank
      const player = playerByName.get(pick.player_name)!
      return {
        ...pick,
        gp: player.stats.gp,
        mpg: player.stats.gp > 0 ? player.stats.minutes / player.stats.gp : 0,
        totalZ: rankedEntry.totalZ,
        valueRank: rankedEntry.rank,
        diff,
        badge: badgeFor(diff),
      }
    }

    const player = playerByName.get(pick.player_name)
    if (!player) {
      return { ...pick, gp: null, mpg: null, totalZ: null, valueRank: null, diff: null, badge: 'DNP' as const }
    }

    const totalZ = scoreAgainstPool(player, referencePool, calcMode, WEIGHTS)
    return {
      ...pick,
      gp: player.stats.gp,
      mpg: player.stats.gp > 0 ? player.stats.minutes / player.stats.gp : 0,
      totalZ,
      valueRank: null,
      diff: pick.pick - fallbackRank,
      badge: player.stats.gp > 0 ? ('INJ' as const) : ('DNP' as const),
    }
  })
}

// A diff of -50 matters more at pick 50 (falling to value #100, basically
// losing half your draft slot's worth) than at pick 120 (falling to #170,
// a round-13-ish throwaway). Normalizing by pick number gives early-round
// misses/hits proportionally more weight than the same raw diff late.
function weightedMagnitude(p: ScoredPick): number {
  return (p.diff ?? 0) / p.pick
}

export function buildTeamGrades(scoredPicks: ScoredPick[]): TeamGrade[] {
  const byTeam = new Map<number, { team_name: string; picks: ScoredPick[] }>()
  for (const p of scoredPicks) {
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, { team_name: p.team_name, picks: [] })
    byTeam.get(p.team_id)!.picks.push(p)
  }

  const teamStats = [...byTeam.entries()].map(([team_id, { team_name, picks }]) => ({
    team_id,
    team_name,
    avgDiff: picks.reduce((s, p) => s + (p.diff ?? 0), 0) / picks.length,
    avgWeighted: picks.reduce((s, p) => s + weightedMagnitude(p), 0) / picks.length,
    zSum: picks.reduce((s, p) => s + (p.totalZ ?? 0), 0),
  }))

  const avgWeightedVals = teamStats.map(t => t.avgWeighted)
  const mean = avgWeightedVals.reduce((s, v) => s + v, 0) / avgWeightedVals.length
  const variance = avgWeightedVals.reduce((s, v) => s + (v - mean) ** 2, 0) / avgWeightedVals.length
  const stdev = Math.sqrt(variance)

  return teamStats
    .map(t => {
      const z = stdev === 0 ? 0 : (t.avgWeighted - mean) / stdev
      const grade: TeamGrade['grade'] = z >= 1.0 ? 'A' : z >= 0.33 ? 'B' : z >= -0.33 ? 'C' : z >= -1.0 ? 'D' : 'F'
      return { ...t, grade }
    })
    .sort((a, b) => b.avgWeighted - a.avgWeighted)
}

const BUST_INJ_PICK_CEILING = 100

export function topSteals(scoredPicks: ScoredPick[], limit = 5): ScoredPick[] {
  return scoredPicks
    .filter(p => p.badge === 'Steal' && (p.gp ?? 0) >= STEAL_MIN_GP)
    .sort((a, b) => weightedMagnitude(b) - weightedMagnitude(a))
    .slice(0, limit)
}

export function topBusts(scoredPicks: ScoredPick[], limit = 5): ScoredPick[] {
  // DNP (no games at all) isn't a "bust" verdict on the player's performance —
  // there's no realized value to judge. A late-round INJ flier isn't
  // newsworthy either; only an injury eating a real (top-100) pick counts.
  const candidates = scoredPicks.filter(p =>
    p.badge === 'Bust' || (p.badge === 'INJ' && p.pick <= BUST_INJ_PICK_CEILING)
  )
  return candidates
    .sort((a, b) => {
      if (a.badge === 'INJ' && b.badge !== 'INJ') return -1
      if (b.badge === 'INJ' && a.badge !== 'INJ') return 1
      if (a.badge === 'INJ' && b.badge === 'INJ') return a.pick - b.pick
      return weightedMagnitude(a) - weightedMagnitude(b)
    })
    .slice(0, limit)
}
