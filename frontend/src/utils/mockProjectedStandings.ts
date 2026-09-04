import type { AdpPlayer, LastYearStats } from '../types/api'
import type { MockSession } from './mockDraft'

export type StandingsMode = 'totals' | 'averages'
export type StatsFrom = 'actual' | 'projection'

export const STANDING_CATS = [
  { key: 'fg_pct', label: 'FG%', pct: true },
  { key: 'ft_pct', label: 'FT%', pct: true },
  { key: 'three_pm', label: '3PM' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
] as const

export type StandingCatKey = (typeof STANDING_CATS)[number]['key']

export type TeamCatValues = Record<StandingCatKey, number | null>

export type ProjectedStandingRow = {
  team: number
  playerCount: number
  values: TeamCatValues
  points: Record<StandingCatKey, number>
  totalPoints: number
  rank: number
}

export const CALC_BY_MIN = 1

const EMPTY_VALUES: TeamCatValues = {
  fg_pct: null,
  ft_pct: null,
  three_pm: null,
  pts: null,
  reb: null,
  ast: null,
  stl: null,
  blk: null,
}

export function clampCalcBy(topN: number, rounds: number): number {
  const max = Math.max(CALC_BY_MIN, rounds)
  if (!Number.isFinite(topN)) return max
  return Math.min(max, Math.max(CALC_BY_MIN, Math.round(topN)))
}

export function calcByOptions(rounds: number): number[] {
  const max = Math.max(CALC_BY_MIN, rounds)
  const out: number[] = []
  for (let n = CALC_BY_MIN; n <= max; n++) out.push(n)
  return out
}

export function formatCalcByLabel(topN: number, rounds: number): string {
  const n = clampCalcBy(topN, rounds)
  if (n >= rounds) return 'All players'
  if (n === 1) return 'Top player'
  return `Top ${n} players`
}

function shootingVolume(stats: LastYearStats, made: 'fgm' | 'ftm', att: 'fga' | 'fta'): { made: number; att: number } {
  return {
    made: (stats[made] ?? 0) * stats.gp,
    att: (stats[att] ?? 0) * stats.gp,
  }
}

export function resolvePlayerStats(player: AdpPlayer | undefined, statsFrom: StatsFrom): LastYearStats | null {
  if (!player) return null
  const stats = statsFrom === 'projection' ? player.projection : player.last_year
  if (!stats || stats.gp <= 0) return null
  return stats
}

export function aggregateTeamCats(
  statsLines: LastYearStats[],
  mode: StandingsMode,
): { values: TeamCatValues; playerCount: number } {
  const eligible = statsLines.filter((s) => s.gp > 0)
  if (eligible.length === 0) return { values: { ...EMPTY_VALUES }, playerCount: 0 }

  let fgm = 0
  let fga = 0
  let ftm = 0
  let fta = 0
  let threePm = 0
  let pts = 0
  let reb = 0
  let ast = 0
  let stl = 0
  let blk = 0
  for (const stats of eligible) {
    const fg = shootingVolume(stats, 'fgm', 'fga')
    const ft = shootingVolume(stats, 'ftm', 'fta')
    fgm += fg.made
    fga += fg.att
    ftm += ft.made
    fta += ft.att
    threePm += stats.three_pm * stats.gp
    pts += stats.ppg * stats.gp
    reb += stats.rpg * stats.gp
    ast += stats.apg * stats.gp
    stl += stats.spg * stats.gp
    blk += stats.bpg * stats.gp
  }

  const teamGp = eligible.reduce((sum, line) => sum + line.gp, 0)
  // Current averages cell was season total / n players. Per-game is that
  // divided by mean GP, which equals season total / team GP.
  const div = mode === 'averages' ? teamGp : 1
  return {
    playerCount: eligible.length,
    values: {
      fg_pct: fga > 0 ? fgm / fga : null,
      ft_pct: fta > 0 ? ftm / fta : null,
      three_pm: threePm / div,
      pts: pts / div,
      reb: reb / div,
      ast: ast / div,
      stl: stl / div,
      blk: blk / div,
    },
  }
}

/** Pandas-style average rank: lowest value gets 1, ties split. Nulls rank last (worst). */
export function rotoPoints(values: Array<number | null>): number[] {
  const n = values.length
  const indexed = values.map((value, index) => ({ index, value }))
  indexed.sort((a, b) => {
    const aNull = a.value == null
    const bNull = b.value == null
    if (aNull !== bNull) return aNull ? -1 : 1
    if (a.value == null || b.value == null) return a.index - b.index
    return a.value - b.value
  })

  const out = new Array<number>(n)
  let pos = 0
  while (pos < n) {
    let end = pos + 1
    while (end < n && sameStandingValue(indexed[end].value, indexed[pos].value)) end += 1
    const avg = (pos + 1 + end) / 2
    for (let i = pos; i < end; i++) out[indexed[i].index] = avg
    pos = end
  }
  return out
}

function sameStandingValue(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return a === b
}

/** Competition rank (min) on already-sorted descending totals. */
export function competitionRankDescending(totals: number[]): number[] {
  const ranks = new Array<number>(totals.length)
  let rank = 1
  for (let i = 0; i < totals.length; i++) {
    if (i > 0 && totals[i] !== totals[i - 1]) rank = i + 1
    ranks[i] = rank
  }
  return ranks
}

export function normalizeColumn(values: Array<number | null>): number[] {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return values.map(() => 0.5)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  if (min === max) {
    const tied = nums.length === values.length ? 0.5 : 1
    return values.map((v) => (v == null ? 0 : tied))
  }
  return values.map((v) => (v == null ? 0 : (v - min) / (max - min)))
}

function firstNPlayerIds(session: MockSession, team: number, topN: number): string[] {
  return session.picks
    .filter((pk) => pk.team === team)
    .sort((a, b) => a.pick - b.pick)
    .slice(0, topN)
    .map((pk) => pk.playerId)
}

export function buildProjectedStandings(input: {
  session: MockSession
  detailsById: Map<string, AdpPlayer>
  statsFrom: StatsFrom
  mode: StandingsMode
  topN: number
}): ProjectedStandingRow[] {
  const { session, detailsById, statsFrom, mode } = input
  const topN = clampCalcBy(input.topN, session.rounds)

  const aggregates = Array.from({ length: session.teams }, (_, i) => {
    const team = i + 1
    const lines: LastYearStats[] = []
    for (const id of firstNPlayerIds(session, team, topN)) {
      const stats = resolvePlayerStats(detailsById.get(id), statsFrom)
      if (stats) lines.push(stats)
    }
    return { team, ...aggregateTeamCats(lines, mode) }
  })

  const pointsByCat = {} as Record<StandingCatKey, number[]>
  for (const cat of STANDING_CATS) {
    pointsByCat[cat.key] = rotoPoints(aggregates.map((row) => row.values[cat.key]))
  }

  const rows: ProjectedStandingRow[] = aggregates.map((row, i) => {
    const points = Object.fromEntries(
      STANDING_CATS.map((cat) => [cat.key, pointsByCat[cat.key][i]]),
    ) as Record<StandingCatKey, number>
    const totalPoints = STANDING_CATS.reduce((sum, cat) => sum + points[cat.key], 0)
    return {
      team: row.team,
      playerCount: row.playerCount,
      values: row.values,
      points,
      totalPoints,
      rank: 0,
    }
  })

  rows.sort((a, b) => b.totalPoints - a.totalPoints || a.team - b.team)
  const ranks = competitionRankDescending(rows.map((row) => row.totalPoints))
  for (let i = 0; i < rows.length; i++) rows[i].rank = ranks[i]
  return rows
}

export function formatStandingValue(key: StandingCatKey, value: number | null, pct: boolean): string {
  if (value == null) return '—'
  if (pct) return `${(value * 100).toFixed(1)}%`
  if (key === 'three_pm' || key === 'pts' || key === 'reb' || key === 'ast' || key === 'stl' || key === 'blk') {
    return value.toFixed(1)
  }
  return value.toFixed(1)
}

export function formatRotoPoints(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
