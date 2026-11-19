import type { RankingStats, SurpriseRow, TeamRankChange } from '../types/api'
import type { SlatePlayerValue } from '../types/boxScore'
import { formatAsOf, formatPoints } from '../components/share/shareCardFormat'
import { orderCategories } from './statOrder'

/** Lines of the night and free agents on the poster. The box-score page shows five. */
export const RECAP_LINES = 3
/** Boom and bust rows on the poster. The page's own share card uses the same cap. */
export const RECAP_SURPRISE_ROWS = 5

export interface RecapStat {
  label: string
  value: string
}

export interface RecapCategory {
  category: string
  /** Roto points that night. Higher is better, same number the rankings table shows. */
  points: number
}

export interface RecapTeam {
  teamId: number
  name: string
  /** Place by total points that night. Ties share a place. */
  rank: number
  total: number
  gp: number
  /** Every scoring category, in the app's column order. */
  categories: RecapCategory[]
}

export interface RecapMove {
  teamId: number
  name: string
  totalDelta: number
  rankDelta: number | null
  /** Roto points gained or lost in each category the move reports. */
  categories: { category: string; delta: number }[]
}

export interface RecapPlayer {
  id: string
  name: string
  nbaTeam: string
  opponent: string
  home: boolean
  fantasyTeam: string | null
  fantasyTeamName: string | null
  /** Full box line. Every column is present, including zeros. */
  stats: RecapStat[]
  z: number
}

export interface RecapSurprise {
  id: number
  name: string
  opponent: string
  home: boolean
  fantasyTeam: string | null
  fantasyTeamName: string | null
  /** Full surprise line: minutes, shooting, and every counting stat. */
  stats: RecapStat[]
  score: number
}

export interface RecapSurpriseSide {
  shown: RecapSurprise[]
  /** How many cleared the default bar, before the poster cap. */
  total: number
  threshold: number
}

export interface DailyRecap {
  best: RecapTeam | null
  worst: RecapTeam | null
  rise: RecapMove | null
  fall: RecapMove | null
  lines: RecapPlayer[]
  freeAgents: RecapPlayer[]
  started: RecapPlayer | null
  benched: RecapPlayer | null
  boom: RecapSurpriseSide
  bust: RecapSurpriseSide
}

/** Standings sort for Total: the number first, and a tie breaks on the name
 * the same way the standings page does (desc puts the later name on top). */
function compareTotal(a: RankingStats, b: RankingStats, order: 'asc' | 'desc'): number {
  const diff = a.total_points - b.total_points
  if (diff !== 0) return order === 'asc' ? diff : -diff
  const an = a.team.team_name.toLowerCase()
  const bn = b.team.team_name.toLowerCase()
  if (an < bn) return order === 'asc' ? -1 : 1
  if (an > bn) return order === 'asc' ? 1 : -1
  return 0
}

function nightRanks(rows: RankingStats[]): Map<number, number> {
  const sorted = [...rows].sort((a, b) => compareTotal(a, b, 'desc'))
  const places = new Map<number, number>()
  sorted.forEach((team, index) => {
    const prev = sorted[index - 1]
    const shared = prev != null && prev.total_points === team.total_points
    places.set(team.team.team_id, shared ? places.get(prev.team.team_id)! : index + 1)
  })
  return places
}

function categoryPoints(team: RankingStats, categories: string[]): RecapCategory[] {
  return orderCategories(categories)
    .filter(category => typeof team.category_ranks?.[category] === 'number')
    .map(category => ({
      category,
      points: team.category_ranks![category],
    }))
}

function asTeam(team: RankingStats, categories: string[], teamCount: number, places: Map<number, number>): RecapTeam {
  return {
    teamId: team.team.team_id,
    name: team.team.team_name,
    rank: places.get(team.team.team_id) ?? teamCount,
    total: team.total_points,
    gp: team.gp,
    categories: categoryPoints(team, categories),
  }
}

/** Top and bottom row of Last 1 day, averages, rankings, sorted by Total. */
export function pickNightTeams(rows: RankingStats[], categories: string[]): { best: RecapTeam | null; worst: RecapTeam | null } {
  if (rows.length === 0) return { best: null, worst: null }
  const places = nightRanks(rows)
  const best = [...rows].sort((a, b) => compareTotal(a, b, 'desc'))[0]
  const worst = [...rows].sort((a, b) => compareTotal(a, b, 'asc'))[0]
  return {
    best: asTeam(best, categories, rows.length, places),
    worst: asTeam(worst, categories, rows.length, places),
  }
}

/** Largest gain and largest loss in season total points. A zero is neither. */
export function pickMoves(teams: TeamRankChange[], categories: string[] = []): { rise: RecapMove | null; fall: RecapMove | null } {
  const gain = teams.filter(team => (team.total_delta ?? 0) > 0)
  const loss = teams.filter(team => (team.total_delta ?? 0) < 0)
  const byMove = (dir: 'rise' | 'fall') => (a: TeamRankChange, b: TeamRankChange) => {
    const delta = a.total_delta! - b.total_delta!
    if (delta !== 0) return dir === 'rise' ? -delta : delta
    const places = (a.rank_delta ?? 0) - (b.rank_delta ?? 0)
    if (places !== 0) return dir === 'rise' ? -places : places
    return a.team_name.localeCompare(b.team_name)
  }
  const asMove = (team: TeamRankChange): RecapMove => ({
    teamId: team.team_id,
    name: team.team_name,
    totalDelta: team.total_delta!,
    rankDelta: team.rank_delta,
    categories: (categories.length ? orderCategories(categories) : orderCategories(Object.keys(team.categories)))
      .filter(category => team.categories[category] != null)
      .map(category => ({ category, delta: team.categories[category] })),
  })
  gain.sort(byMove('rise'))
  loss.sort(byMove('fall'))
  return {
    rise: gain[0] ? asMove(gain[0]) : null,
    fall: loss[0] ? asMove(loss[0]) : null,
  }
}

function minutesOf(player: SlatePlayerValue): number {
  const minutes = player.stats?.MIN
  if (typeof minutes === 'number') return minutes
  const head = Number.parseFloat(player.min)
  return Number.isFinite(head) ? head : 0
}

function played(player: SlatePlayerValue): boolean {
  return minutesOf(player) > 0
}

/** started false and not IR is a bench spot, matching the box-score mark.
 * A null `started` is an unknown slot and stays out. */
function lineup(player: SlatePlayerValue): 'started' | 'bench' | 'ir' | null {
  if (!player.fantasy_team) return null
  if (player.started == null) return null
  if (player.started) return 'started'
  if (player.lineup_slot === 'IR') return 'ir'
  return 'bench'
}

function boxStats(player: SlatePlayerValue): RecapStat[] {
  const cell = (value: string | undefined, fallback: string) => (value == null || value === '' ? fallback : value)
  return [
    { label: 'MIN', value: cell(player.min, '0') },
    { label: 'FG', value: cell(player.fg, '0-0') },
    { label: '3PT', value: cell(player.fg3, '0-0') },
    { label: 'FT', value: cell(player.ft, '0-0') },
    { label: 'REB', value: cell(player.reb, '0') },
    { label: 'AST', value: cell(player.ast, '0') },
    { label: 'STL', value: cell(player.stl, '0') },
    { label: 'BLK', value: cell(player.blk, '0') },
    { label: 'TO', value: cell(player.tov, '0') },
    { label: 'PTS', value: cell(player.pts, '0') },
  ]
}

function asPlayer(player: SlatePlayerValue): RecapPlayer {
  return {
    id: player.player_id,
    name: player.name,
    nbaTeam: player.team_abbr,
    opponent: player.opponent_abbr,
    home: player.is_home,
    fantasyTeam: player.fantasy_team,
    fantasyTeamName: player.fantasy_team_name,
    stats: boxStats(player),
    z: player.z,
  }
}

/** Highest Z first, same order Lines of the Night uses. */
export function pickLines(players: SlatePlayerValue[]): { lines: RecapPlayer[]; freeAgents: RecapPlayer[] } {
  const byZ = [...players].sort((a, b) => b.z - a.z || a.name.localeCompare(b.name))
  return {
    lines: byZ.slice(0, RECAP_LINES).map(asPlayer),
    freeAgents: byZ.filter(player => player.fantasy_team == null).slice(0, RECAP_LINES).map(asPlayer),
  }
}

/** Worst Z among players who started and played, and best Z among those who
 * were benched and played. */
export function pickStartBench(players: SlatePlayerValue[]): { started: RecapPlayer | null; benched: RecapPlayer | null } {
  const starters = players.filter(player => played(player) && lineup(player) === 'started')
  const bench = players.filter(player => played(player) && lineup(player) === 'bench')
  starters.sort((a, b) => a.z - b.z || a.name.localeCompare(b.name))
  bench.sort((a, b) => b.z - a.z || a.name.localeCompare(b.name))
  return {
    started: starters[0] ? asPlayer(starters[0]) : null,
    benched: bench[0] ? asPlayer(bench[0]) : null,
  }
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function shot(made: number, attempts: number): string {
  return `${num(made)}-${num(attempts)}`
}

function surpriseStats(row: SurpriseRow): RecapStat[] {
  return [
    { label: 'MIN', value: num(row.minutes) },
    { label: 'FG', value: shot(row.fgm, row.fga) },
    { label: 'FT', value: shot(row.ftm, row.fta) },
    { label: '3PM', value: num(row.fg3m) },
    { label: 'REB', value: num(row.reb) },
    { label: 'AST', value: num(row.ast) },
    { label: 'STL', value: num(row.stl) },
    { label: 'BLK', value: num(row.blk) },
    { label: 'PTS', value: num(row.pts) },
  ]
}

function asSurprise(row: SurpriseRow): RecapSurprise {
  return {
    id: row.player_id,
    name: row.player_name,
    opponent: row.opponent_abbr,
    home: row.is_home,
    fantasyTeam: row.fantasy_team,
    fantasyTeamName: row.fantasy_team_name ?? null,
    stats: surpriseStats(row),
    score: row.score,
  }
}

/** Default last-night bars. Rows arrive best-first and worst-first. */
export function pickSurprises(
  good: SurpriseRow[],
  bad: SurpriseRow[],
  thresholds: { good: number; bad: number },
): { boom: RecapSurpriseSide; bust: RecapSurpriseSide } {
  const booms = good.filter(row => row.score >= thresholds.good)
  const busts = bad.filter(row => row.score <= -thresholds.bad)
  return {
    boom: { shown: booms.slice(0, RECAP_SURPRISE_ROWS).map(asSurprise), total: booms.length, threshold: thresholds.good },
    bust: { shown: busts.slice(0, RECAP_SURPRISE_ROWS).map(asSurprise), total: busts.length, threshold: thresholds.bad },
  }
}

export function buildDailyRecap(input: {
  rankings: RankingStats[]
  categories: string[]
  moves: TeamRankChange[]
  players: SlatePlayerValue[]
  good: SurpriseRow[]
  bad: SurpriseRow[]
  thresholds: { good: number; bad: number }
}): DailyRecap {
  return {
    ...pickNightTeams(input.rankings, input.categories),
    ...pickMoves(input.moves, input.categories),
    ...pickLines(input.players),
    ...pickStartBench(input.players),
    ...pickSurprises(input.good, input.bad, input.thresholds),
  }
}

/** Header date from the standings range. When the player night is a different
 * day, `linesNote` carries it so the poster does not pretend they are one. */
export function recapNightLabel(
  actualStart?: string | null,
  actualEnd?: string | null,
  surpriseDate?: string | null,
): { headline: string; linesNote: string | null } {
  const standings = actualStart && actualEnd && actualStart !== actualEnd
    ? `${formatAsOf(actualStart)} – ${formatAsOf(actualEnd)}`
    : actualStart
      ? formatAsOf(actualStart)
      : actualEnd
        ? formatAsOf(actualEnd)
        : null
  const lines = surpriseDate ? formatAsOf(surpriseDate) : null
  return {
    headline: standings ?? lines ?? 'Last night',
    linesNote: lines && standings && lines !== standings ? lines : null,
  }
}

export function signedPoints(value: number): string {
  const body = formatPoints(Math.abs(value))
  if (value > 0) return `+${body}`
  if (value < 0) return `−${body}`
  return body
}

/** "up 2 places" / "down 1 place" / "same place". */
export function placesMoved(delta: number | null): string {
  if (delta == null) return ''
  if (delta === 0) return 'same place'
  const places = Math.abs(delta) === 1 ? 'place' : 'places'
  return delta > 0 ? `up ${delta} ${places}` : `down ${Math.abs(delta)} ${places}`
}

export function dailyRecapMessage(headline: string, best: RecapTeam | null, url: string): string {
  const night = best ? `Best night: *${best.name}* (${formatPoints(best.total)})` : 'Best night: —'
  return [`*Fantasy Daily Recap* · ${headline}`, night, `🔗 ${url}`].join('\n')
}

export function surpriseCount(side: RecapSurpriseSide): string {
  if (side.total === 0) return 'none'
  if (side.total > side.shown.length) return `top ${side.shown.length} of ${side.total}`
  return `${side.total}`
}
