import type { Player, DraftPick } from '../types/api'
import { normalizePlayerName } from './playerName'
import {
  computePlayerRankings,
  scoreAgainstPool,
  partitionByDataAvailability,
  DEFAULT_CATEGORIES,
  type RankingCategory,
} from './playerRankings'

export type DraftBadge = 'Steal' | 'Solid' | 'Fair' | 'Reach' | 'Bust' | 'INJ' | 'Low GP' | 'DNP'

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
  ratio: number
  hitRate: number
  grade: 'A' | 'B' | 'C' | 'D' | 'F'
}

export interface UnrankedPick {
  player_name: string
  badge: DraftBadge
  gp: number | null
  pick: number
}

export interface TeamDiff {
  team_id: number
  team_name: string
  avgDiff: number
  totalDiff: number
  n: number
  total: number
  unranked: UnrankedPick[]
}

const WEIGHTS = Object.fromEntries(DEFAULT_CATEGORIES.map(c => [c, 1])) as Record<RankingCategory, number>

/** Min games played to enter the season value pool on Draft Report and FA Report. */
export const REPORT_MIN_GP = 10

function badgeFor(diff: number): DraftBadge {
  if (diff >= 25) return 'Steal'
  if (diff >= 10) return 'Solid'
  if (diff > -10) return 'Fair'
  if (diff > -25) return 'Reach'
  return 'Bust'
}

/** Draft picks with no realized games — shown on the board but excluded from value math. */
export function isDnpPick(p: ScoredPick): boolean {
  return p.badge === 'DNP'
}

/** Played some games but below REPORT_MIN_GP — excluded from value math, not a true DNP. */
export function isLowGpPick(p: ScoredPick): boolean {
  return p.badge === 'Low GP'
}

export function isExcludedFromValuePick(p: ScoredPick): boolean {
  return isDnpPick(p) || isLowGpPick(p)
}

export interface SeasonValueEntry {
  valueRank: number
  totalZ: number
  gp: number
}

function computeSeasonValueMaps(allPlayers: Player[], calcMode: 'totals' | 'per_game', minGpForRank: number = 0) {
  const { available } = partitionByDataAvailability(allPlayers)
  const poolMinGp = Math.max(minGpForRank, 1)
  const ranked = computePlayerRankings(available, { calcMode, minGp: poolMinGp, minMin: 0, position: null, weights: WEIGHTS })
  const referencePool = ranked.map(r => r.player)
  const zByName = new Map(ranked.map(r => [r.player.player_name, r.totalZ]))
  const qualified = available.filter(p => p.stats.gp >= poolMinGp)
  const fullyRanked = qualified
    .map(p => ({ player: p, totalZ: zByName.get(p.player_name) ?? scoreAgainstPool(p, referencePool, calcMode, WEIGHTS) }))
    .sort((a, b) => b.totalZ - a.totalZ)
  const rankByName = new Map(fullyRanked.map((r, i) => [r.player.player_name, { rank: i + 1, totalZ: r.totalZ }]))
  const playerByName = new Map(available.map(p => [p.player_name, p]))
  return { rankByName, playerByName, referencePool, calcMode, available }
}

/** Season 8-cat value rank keyed by normalized player name (same pool as Draft Report). */
export function buildSeasonValueRankByName(
  allPlayers: Player[],
  calcMode: 'totals' | 'per_game',
  minGpForRank: number = REPORT_MIN_GP,
): Map<string, SeasonValueEntry> {
  const { rankByName, playerByName } = computeSeasonValueMaps(allPlayers, calcMode, minGpForRank)
  const out = new Map<string, SeasonValueEntry>()
  for (const [name, entry] of rankByName) {
    const player = playerByName.get(name)
    if (!player || player.stats.gp < minGpForRank) continue
    out.set(normalizePlayerName(name), {
      valueRank: entry.rank,
      totalZ: entry.totalZ,
      gp: player.stats.gp,
    })
  }
  return out
}

export function buildScoredPicks(
  picks: DraftPick[],
  allPlayers: Player[],
  calcMode: 'totals' | 'per_game',
  minGpForRank: number = REPORT_MIN_GP,
): ScoredPick[] {
  const poolMinGp = Math.max(minGpForRank, 1)
  const { rankByName, playerByName, referencePool, calcMode: mode, available } = computeSeasonValueMaps(
    allPlayers,
    calcMode,
    minGpForRank,
  )
  const fallbackRank = available.length + 40

  const dnpPick = (pick: DraftPick, gp: number | null): ScoredPick => ({
    ...pick,
    gp,
    mpg: null,
    totalZ: null,
    valueRank: null,
    diff: null,
    badge: 'DNP',
  })

  const lowGpPick = (pick: DraftPick, gp: number): ScoredPick => ({
    ...pick,
    gp,
    mpg: gp > 0 ? (playerByName.get(pick.player_name)!.stats.minutes / gp) : null,
    totalZ: null,
    valueRank: null,
    diff: null,
    badge: 'Low GP',
  })

  return picks.map(pick => {
    const player = playerByName.get(pick.player_name)
    if (!player || player.stats.gp <= 0) {
      return dnpPick(pick, player?.stats.gp ?? null)
    }
    if (player.stats.gp < poolMinGp) {
      return lowGpPick(pick, player.stats.gp)
    }

    const rankedEntry = rankByName.get(pick.player_name)
    if (rankedEntry) {
      const diff = pick.pick - rankedEntry.rank
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

    const totalZ = scoreAgainstPool(player, referencePool, mode, WEIGHTS)
    return {
      ...pick,
      gp: player.stats.gp,
      mpg: player.stats.gp > 0 ? player.stats.minutes / player.stats.gp : 0,
      totalZ,
      valueRank: null,
      diff: pick.pick - fallbackRank,
      badge: 'INJ' as const,
    }
  })
}

// Rank isn't linear in value: #1 vs #10 is a real talent gap, #100 vs #110 is
// noise. A concave value curve (steep at the top, flat at the bottom) captures
// that. Draft surplus = value gained at the realized rank minus value paid at
// the pick slot, both read off the same curve — so a 20→10 jump outweighs a
// 30→20 jump of equal size, and early accuracy weighs more than late.
// The +OFFSET tames the near-vertical very top of the curve so a 1-rank slip
// on an elite pick (e.g. slot 2 returning #3) reads as roughly neutral, not as
// a bigger loss than a genuine mid-round bust.
const VALUE_EXP = 0.7
const VALUE_OFFSET = 5
function valueScore(rank: number): number {
  return 1 / Math.pow(rank + VALUE_OFFSET, VALUE_EXP)
}

// INJ/DNP picks return null valueRank; an injury isn't a drafting mistake, so
// they contribute zero surplus (neither reward nor penalty).
function pickSurplus(p: ScoredPick): number {
  if (p.valueRank === null) return 0
  return valueScore(p.valueRank) - valueScore(p.pick)
}

// Draft grade blends two absolute signals so a team isn't graded on totals
// alone: the value-efficiency ratio (realized ÷ expected value at their slots,
// 1.0 = par) times a hit-rate factor (share of picks that beat their slot).
// The factor is 1.0 at a 50% hit rate, so a lopsided draft carried by one steal
// grades below a steady one at the same ratio. Grades are generous and floor at
// D — no team is handed an F.
const GRADE_CUTS: [number, TeamGrade['grade']][] = [
  [1.04, 'A'], [0.88, 'B'], [0.76, 'C'],
]
function gradeForScore(score: number): TeamGrade['grade'] {
  for (const [cut, grade] of GRADE_CUTS) if (score >= cut) return grade
  return 'D'
}

export function buildTeamGrades(scoredPicks: ScoredPick[]): TeamGrade[] {
  const byTeam = new Map<number, { team_name: string; picks: ScoredPick[] }>()
  for (const p of scoredPicks) {
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, { team_name: p.team_name, picks: [] })
    byTeam.get(p.team_id)!.picks.push(p)
  }

  const teamStats = [...byTeam.entries()].map(([team_id, { team_name, picks }]) => {
    const judged = picks.filter(p => p.valueRank !== null && !isDnpPick(p))
    const realized = judged.reduce((s, p) => s + valueScore(p.valueRank!), 0)
    const expected = judged.reduce((s, p) => s + valueScore(p.pick), 0)
    const ratio = expected > 0 ? realized / expected : 1
    const hitRate = judged.length > 0
      ? judged.filter(p => valueScore(p.valueRank!) > valueScore(p.pick)).length / judged.length
      : 0
    return {
      team_id,
      team_name,
      ratio,
      hitRate,
      score: ratio * (0.75 + 0.5 * hitRate),
    }
  })

  return teamStats
    .sort((a, b) => b.score - a.score)
    .map(t => ({
      team_id: t.team_id,
      team_name: t.team_name,
      ratio: t.ratio,
      hitRate: t.hitRate,
      grade: gradeForScore(t.score),
    }))
}

// Signed diff (pick − value rank) averaged per team: positive = the team's
// picks returned above their draft slot. INJ/DNP picks carry a noisy fallback
// diff, so only judged picks (real valueRank) count. Sorted best surplus first.
export function buildTeamDiffRanking(scoredPicks: ScoredPick[]): TeamDiff[] {
  const byTeam = new Map<number, { team_name: string; diffs: number[]; total: number; unranked: UnrankedPick[] }>()
  for (const p of scoredPicks) {
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, { team_name: p.team_name, diffs: [], total: 0, unranked: [] })
    const e = byTeam.get(p.team_id)!
    if (isExcludedFromValuePick(p)) {
      e.total++
      e.unranked.push({ player_name: p.player_name, badge: p.badge, gp: p.gp, pick: p.pick })
      continue
    }
    e.total++
    if (p.valueRank !== null && p.diff !== null) e.diffs.push(p.diff)
    else e.unranked.push({ player_name: p.player_name, badge: p.badge, gp: p.gp, pick: p.pick })
  }
  return [...byTeam.entries()]
    .filter(([, { diffs }]) => diffs.length > 0)
    .map(([team_id, { team_name, diffs, total, unranked }]) => {
      const totalDiff = diffs.reduce((s, d) => s + d, 0)
      return {
        team_id,
        team_name,
        avgDiff: totalDiff / diffs.length,
        totalDiff,
        n: diffs.length,
        total,
        unranked: unranked.sort((a, b) => a.pick - b.pick),
      }
    })
    .sort((a, b) => b.avgDiff - a.avgDiff)
}

export function topSteals(scoredPicks: ScoredPick[], limit = 5): ScoredPick[] {
  return scoredPicks
    .filter(p => p.badge === 'Steal' && !isDnpPick(p))
    .sort((a, b) => pickSurplus(b) - pickSurplus(a))
    .slice(0, limit)
}

export function topBusts(scoredPicks: ScoredPick[], limit = 5): ScoredPick[] {
  // Only players who actually played and underperformed their slot are busts.
  // INJ/DNP carry no realized value to judge — an injury is bad luck, not a bad
  // pick — so they're excluded rather than ranked as the "worst" outcomes.
  return scoredPicks
    .filter(p => p.badge === 'Bust' && !isDnpPick(p))
    .sort((a, b) => pickSurplus(a) - pickSurplus(b))
    .slice(0, limit)
}
