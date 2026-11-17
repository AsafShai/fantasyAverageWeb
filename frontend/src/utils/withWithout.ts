import type { Player } from '../types/api'
import type { WithWithoutEntry, WithWithoutPlayer, WithWithoutTeamSeason } from '../types/withWithout'
import { computePlayerRankings, partitionByDataAvailability, scoreAgainstPool, type RankingCategory } from './playerRankings'

/** How a team game is used: picked players all played, (all/any) sat, or neither. */
export type GameKind = 'with' | 'without' | 'unused'
export type MatchMode = 'all' | 'any'

export const MAX_PICKS = 3
/** Under this many "without" games a row is tagged "small". */
export const SMALL_SAMPLE = 3

const played = (e: WithWithoutEntry): e is number[] => Array.isArray(e)

/**
 * Splits the team's games for the picked players. A game counts as
 *  - "with" when every picked player played,
 *  - "without" when all of them sat ("all"), or at least one sat ("any"),
 *  - "unused" otherwise: only some sat in "all" mode, or a picked player
 *    wasn't on the team yet (or anymore) that day.
 */
export function splitGames(season: WithWithoutTeamSeason, picked: WithWithoutPlayer[], mode: MatchMode): GameKind[] {
  return season.games.map((_, i) => {
    if (picked.length === 0) return 'unused'
    const entries = picked.map(p => p.lines[i])
    if (entries.some(e => e === null)) return 'unused'
    const sat = entries.filter(e => e === 0).length
    if (sat === 0) return 'with'
    if (mode === 'all' ? sat === picked.length : sat > 0) return 'without'
    return 'unused'
  })
}

/** Games he missed out of the games he was on the team for. */
export function missedGames(player: WithWithoutPlayer): { missed: number; onTeam: number } {
  const onTeam = player.lines.filter(e => e !== null).length
  const missed = player.lines.filter(e => e === 0).length
  return { missed, onTeam }
}

/** A group of games summed: totals per field, and how many games. */
export interface GroupLine {
  games: number
  totals: Record<string, number>
}

export function groupLine(entries: number[][], fields: string[]): GroupLine {
  const totals: Record<string, number> = Object.fromEntries(fields.map(f => [f, 0]))
  for (const e of entries) fields.forEach((f, i) => { totals[f] += e[i] ?? 0 })
  return { games: entries.length, totals }
}

const PCT: Record<string, [string, string]> = { 'FG%': ['FGM', 'FGA'], 'FT%': ['FTM', 'FTA'], '3P%': ['3PM', '3PA'] }
const ALIASES: Record<string, string> = { PPG: 'PTS', RPG: 'REB', APG: 'AST', BPG: 'BLK', SPG: 'STL', TOPG: 'TO', '3PG': '3PM' }

export function isPct(cat: string): boolean {
  return cat in PCT
}

/** Per-game value of a stat or category over the group. Percentages are total
 * makes over total attempts, never an average of per-game percentages, and
 * NaN when he took no attempts (no percentage to compare). */
export function perGame(group: GroupLine, cat: string): number {
  if (group.games === 0) return 0
  const pct = PCT[cat]
  if (pct) {
    const att = group.totals[pct[1]] ?? 0
    return att > 0 ? (group.totals[pct[0]] ?? 0) / att : Number.NaN
  }
  return (group.totals[ALIASES[cat] ?? cat] ?? 0) / group.games
}

// With no attempts the percentage's impact is 0 whatever it is, as in Player Rankings.
const pctOrZero = (group: GroupLine, cat: string) => {
  const v = perGame(group, cat)
  return Number.isNaN(v) ? 0 : v
}

/** The group in the shape Player Rankings scores: season totals over `games`. */
export function groupAsPlayer(name: string, group: GroupLine, categories: string[]): Player {
  const t = group.totals
  const stats: Record<string, number> = {}
  for (const cat of categories) {
    stats[cat] = isPct(cat) ? pctOrZero(group, cat) : (t[ALIASES[cat] ?? cat] ?? 0)
  }
  return {
    player_name: name,
    pro_team: '',
    positions: [],
    team_id: 0,
    status: 'FREEAGENT',
    stats: {
      pts: t.PTS ?? 0, reb: t.REB ?? 0, ast: t.AST ?? 0, stl: t.STL ?? 0, blk: t.BLK ?? 0,
      fgm: t.FGM ?? 0, fga: t.FGA ?? 0, ftm: t.FTM ?? 0, fta: t.FTA ?? 0,
      fg_percentage: pctOrZero(group, 'FG%'), ft_percentage: pctOrZero(group, 'FT%'), three_pm: t['3PM'] ?? 0,
      minutes: t.MIN ?? 0, gp: group.games,
      stats,
    },
  }
}

/** What Z is scored against: the Player Rankings page at its defaults (per
 * game, no minimums, equal weights, its top-300 pool). */
export interface ZContext {
  pool: Player[]
  categories: RankingCategory[]
  reverse: Set<RankingCategory>
  weights: Record<RankingCategory, number>
}

export function buildZContext(players: Player[], categories: string[], reverseCategories: string[]): ZContext {
  const weights = Object.fromEntries(categories.map(c => [c, 1])) as Record<RankingCategory, number>
  const reverse = new Set(reverseCategories)
  const { available } = partitionByDataAvailability(players)
  const ranked = computePlayerRankings(
    available,
    { calcMode: 'per_game', minGp: 0, minMin: 0, position: null, weights },
    categories,
    reverse,
  )
  return { pool: ranked.map(r => r.player), categories, reverse, weights }
}

export function zOf(name: string, group: GroupLine, ctx: ZContext): number {
  if (group.games === 0 || ctx.pool.length === 0) return 0
  return scoreAgainstPool(groupAsPlayer(name, group, ctx.categories), ctx.pool, 'per_game', ctx.weights, ctx.categories, ctx.reverse)
}

export interface TeammateRow {
  player: WithWithoutPlayer
  withGroup: GroupLine
  withoutGroup: GroupLine
  /** Per-game values by column (MIN + league categories). */
  withVals: Record<string, number>
  withoutVals: Record<string, number>
  deltas: Record<string, number>
  zWith: number | null
  zWithout: number | null
  zDelta: number | null
  small: boolean
}

/**
 * One row per teammate (not a picked player) who played at least one "with"
 * game and one "without" game. Each side averages only the games he played.
 */
export function teammateRows(
  season: WithWithoutTeamSeason,
  pickedIds: number[],
  kinds: GameKind[],
  columns: string[],
  ctx: ZContext | null,
): TeammateRow[] {
  const rows: TeammateRow[] = []
  for (const player of season.players) {
    if (pickedIds.includes(player.player_id)) continue
    const w: number[][] = []
    const wo: number[][] = []
    player.lines.forEach((e, i) => {
      if (!played(e)) return
      if (kinds[i] === 'with') w.push(e)
      else if (kinds[i] === 'without') wo.push(e)
    })
    if (w.length === 0 || wo.length === 0) continue
    const withGroup = groupLine(w, season.line_fields)
    const withoutGroup = groupLine(wo, season.line_fields)
    const withVals = Object.fromEntries(columns.map(c => [c, perGame(withGroup, c)]))
    const withoutVals = Object.fromEntries(columns.map(c => [c, perGame(withoutGroup, c)]))
    const deltas = Object.fromEntries(columns.map(c => [c, withoutVals[c] - withVals[c]]))
    const zWith = ctx ? zOf(player.name, withGroup, ctx) : null
    const zWithout = ctx ? zOf(player.name, withoutGroup, ctx) : null
    rows.push({
      player, withGroup, withoutGroup, withVals, withoutVals, deltas,
      zWith, zWithout, zDelta: zWith !== null && zWithout !== null ? zWithout - zWith : null,
      small: wo.length < SMALL_SAMPLE,
    })
  }
  return rows
}

/** A played game's value for a column, for the game-by-game log. */
export function entryValue(entry: number[], fields: string[], cat: string): number | null {
  const pct = PCT[cat]
  if (pct) {
    const m = entry[fields.indexOf(pct[0])] ?? 0
    const a = entry[fields.indexOf(pct[1])] ?? 0
    return a > 0 ? m / a : null
  }
  const i = fields.indexOf(ALIASES[cat] ?? cat)
  return i === -1 ? null : entry[i]
}

export function formatStat(cat: string, v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—'
  return isPct(cat) ? `${(v * 100).toFixed(1)}%` : v.toFixed(1)
}

/** One game's value: whole numbers for counting stats, one decimal for %. */
export function formatGameStat(cat: string, v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—'
  return isPct(cat) ? `${(v * 100).toFixed(1)}%` : String(Math.round(v))
}

/** Signed change: percentages in points (+2.3), counting stats one decimal. */
export function formatDelta(cat: string, d: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (Number.isNaN(d)) return { text: '—', dir: 'flat' }
  const x = isPct(cat) ? d * 100 : d
  const flat = Math.abs(x) < (isPct(cat) ? 0.3 : 0.05)
  if (flat) return { text: '±0', dir: 'flat' }
  return { text: `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`, dir: x > 0 ? 'up' : 'down' }
}

export function formatZ(z: number | null): string {
  if (z === null) return '—'
  return `${z > 0 ? '+' : z < 0 ? '−' : '±'}${Math.abs(z).toFixed(2)}`
}

/** "Embiid", "Embiid & George", "Embiid, George or Maxey". */
export function joinNames(names: string[], conj: '&' | 'or'): string {
  const last = names.map(n => n.split(' ').slice(1).join(' ') || n)
  if (last.length <= 1) return last[0] ?? ''
  return `${last.slice(0, -1).join(', ')} ${conj} ${last[last.length - 1]}`
}

/** A played game's cell in the game log: makes/attempts for a percentage
 * category (e.g. "7/15"), a whole number otherwise. */
export function gameLogCell(entry: number[], fields: string[], cat: string): string {
  const pct = PCT[cat]
  if (pct) {
    const m = entry[fields.indexOf(pct[0])] ?? 0
    const a = entry[fields.indexOf(pct[1])] ?? 0
    return `${Math.round(m)}/${Math.round(a)}`
  }
  return formatGameStat(cat, entryValue(entry, fields, cat))
}

/** Game-log column header: "FG" for FG% (the cells are makes/attempts). */
export function gameLogLabel(cat: string): string {
  return isPct(cat) ? cat.replace('%', '') : cat
}

// ESPN's short team codes that differ from the NBA's.
const ESPN_ABBR: Record<string, string> = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' }

/** An ESPN pro-team code as the NBA writes it (GS → GSW). */
export function nbaAbbr(code: string): string {
  const up = code.toUpperCase()
  return ESPN_ABBR[up] ?? up
}
