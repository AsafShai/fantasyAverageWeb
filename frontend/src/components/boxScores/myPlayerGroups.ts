import { fantasyLineupState, resolveFantasyContext } from './fantasyLineupMark'
import { fantasyProTeam } from './proTeam'
import type { RosterDayPlayer } from '../../types/api'
import type { BoxPlayerLine, BoxScoreGame, FantasyNightContext, GameBoxScore, SlatePlayerValue, SlateValues } from '../../types/boxScore'

export interface MyAppearance {
  playerId: string
  name: string
  position: string
  teamAbbr: string
  teamLogo: string
  opponentAbbr: string
  isHome: boolean
  game: BoxScoreGame
}

export interface MyGroups {
  /** Game has not tipped. */
  upcoming: MyAppearance[]
  /** Game is in progress. */
  live: MyAppearance[]
  /** Game is over. */
  done: MyAppearance[]
}

export interface MineRosterPlayer {
  player_id?: number | null
  player_name: string
  pro_team: string
  positions: string[]
}

/** Roster as of the slate date — anyone except `no_game` can appear when their NBA team plays. */
export function minePlayersFromRosterDay(players: RosterDayPlayer[]): MineRosterPlayer[] {
  return players
    .filter(player => player.status !== 'no_game')
    .map(player => ({
      player_id: player.player_id,
      player_name: player.player_name,
      pro_team: player.pro_team,
      positions: player.positions,
    }))
}

export type MyLine =
  | { kind: 'played'; line: BoxPlayerLine }
  | { kind: 'dnp'; reason: string; jersey: string }
  | { kind: 'out' }

/** Roster players whose NBA team is on this slate, in tip order then name. */
export function myAppearances(players: MineRosterPlayer[], games: BoxScoreGame[]): MyAppearance[] {
  const byTeam = new Map<string, { game: BoxScoreGame; home: boolean }>()
  for (const game of games) {
    byTeam.set(fantasyProTeam(game.away.abbreviation), { game, home: false })
    byTeam.set(fantasyProTeam(game.home.abbreviation), { game, home: true })
  }
  const rows: MyAppearance[] = []
  for (const player of players) {
    if (player.player_id == null || !player.pro_team) continue
    const match = byTeam.get(player.pro_team)
    if (!match) continue
    const mine = match.home ? match.game.home : match.game.away
    const opponent = match.home ? match.game.away : match.game.home
    rows.push({
      playerId: String(player.player_id),
      name: player.player_name,
      position: player.positions.filter(Boolean).join('/'),
      teamAbbr: mine.abbreviation,
      teamLogo: mine.logo,
      opponentAbbr: opponent.abbreviation,
      isHome: match.home,
      game: match.game,
    })
  }
  return rows.sort((a, b) => a.game.start_time.localeCompare(b.game.start_time)
    || a.game.game_id.localeCompare(b.game.game_id)
    || a.name.localeCompare(b.name))
}

/** Who logged minutes in each finished game, from the slate-values payload. */
export function playedMinutesByGame(values: SlateValues): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const line of values.players) {
    if (line.game_status !== 'final') continue
    if ((line.stats?.MIN ?? 0) <= 0) continue
    let set = map.get(line.game_id)
    if (!set) {
      set = new Set()
      map.set(line.game_id, set)
    }
    set.add(line.player_id)
  }
  return map
}

/** Scheduled: drop Out. Final: only players who played, when slate lines are available. */
export function filterMineAppearances(
  rows: MyAppearance[],
  outIds: ReadonlySet<string>,
  playedByGame?: ReadonlyMap<string, ReadonlySet<string>>,
): MyAppearance[] {
  return rows.filter(row => {
    if (row.game.status === 'scheduled' && outIds.has(row.playerId)) return false
    if (row.game.status === 'final' && playedByGame) {
      return playedByGame.get(row.game.game_id)?.has(row.playerId) ?? false
    }
    return true
  })
}

export function groupAppearances(rows: MyAppearance[]): MyGroups {
  const groups: MyGroups = { upcoming: [], live: [], done: [] }
  for (const row of rows) {
    if (row.game.status === 'live') groups.live.push(row)
    else if (row.game.status === 'final') groups.done.push(row)
    else groups.upcoming.push(row)
  }
  return groups
}

export function isFantasyActiveLineup(
  playerId: string,
  fantasyPlayers?: Record<string, FantasyNightContext>,
  values?: Map<string, SlatePlayerValue>,
): boolean {
  return fantasyLineupState(resolveFantasyContext(playerId, values, fantasyPlayers)) === 'started'
}

export function filterMyGroups(groups: MyGroups, keep: (row: MyAppearance) => boolean): MyGroups {
  return {
    upcoming: groups.upcoming.filter(keep),
    live: groups.live.filter(keep),
    done: groups.done.filter(keep),
  }
}

/** Counting totals for rostered players who logged minutes on a completed slate. */
export interface MySlateTotals {
  players: number
  min: number
  pts: number
  reb: number
  ast: number
  stl: number
  blk: number
  tov: number
  threePm: number
  fg3a: number
  fgm: number
  fga: number
  ftm: number
  fta: number
  oreb: number
  dreb: number
  pf: number
}

export function mySlateTotals(
  appearances: MyAppearance[],
  playerValues?: Map<string, SlatePlayerValue>,
): MySlateTotals | null {
  if (!playerValues) return null
  const totals: MySlateTotals = {
    players: 0,
    min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, threePm: 0, fg3a: 0,
    fgm: 0, fga: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0, pf: 0,
  }
  for (const row of appearances) {
    const line = playerValues.get(row.playerId)
    const stats = line?.stats
    if (!stats || (stats.MIN ?? 0) <= 0) continue
    totals.players += 1
    totals.min += stats.MIN ?? 0
    totals.pts += stats.PTS ?? 0
    totals.reb += stats.REB ?? 0
    totals.ast += stats.AST ?? 0
    totals.stl += stats.STL ?? 0
    totals.blk += stats.BLK ?? 0
    totals.tov += stats.TO ?? 0
    totals.threePm += stats['3PM'] ?? 0
    totals.fg3a += stats['3PA'] ?? 0
    totals.fgm += stats.FGM ?? 0
    totals.fga += stats.FGA ?? 0
    totals.ftm += stats.FTM ?? 0
    totals.fta += stats.FTA ?? 0
    totals.oreb += stats.OREB ?? 0
    totals.dreb += stats.DREB ?? 0
    totals.pf += stats.PF ?? 0
  }
  return totals.players > 0 ? totals : null
}

/** Percentage category -> makes and attempts in a slate line's stats dict. */
const SLATE_PCT_PARTS: Record<string, [string, string]> = {
  'FG%': ['FGM', 'FGA'],
  'FT%': ['FTM', 'FTA'],
  '3P%': ['3PM', '3PA'],
}

export interface MySlateCategoryTotals {
  players: number
  min: number
  /** Aggregated value per league category (percentages as 0–1 ratios). */
  categories: Record<string, number>
  /** Combined makes/attempts for percentage scoring categories (FG%, FT%, 3P%). */
  shooting: Partial<Record<keyof typeof SLATE_PCT_PARTS, { made: number; att: number }>>
}

/** Sum each scoring category across my players who logged minutes (percentages from combined makes/attempts). */
export function mySlateCategoryTotals(
  appearances: MyAppearance[],
  playerValues: Map<string, SlatePlayerValue> | undefined,
  categories: string[],
): MySlateCategoryTotals | null {
  if (!playerValues || categories.length === 0) return null
  const sums = Object.fromEntries(categories.filter(c => !(c in SLATE_PCT_PARTS)).map(c => [c, 0])) as Record<string, number>
  const parts = Object.fromEntries(
    categories.filter(c => c in SLATE_PCT_PARTS).map(c => [c, { made: 0, att: 0 }]),
  ) as Record<string, { made: number; att: number }>
  let players = 0
  let min = 0
  for (const row of appearances) {
    const line = playerValues.get(row.playerId)
    const stats = line?.stats
    if (!stats || (stats.MIN ?? 0) <= 0) continue
    players += 1
    min += stats.MIN ?? 0
    for (const cat of categories) {
      const pair = SLATE_PCT_PARTS[cat]
      if (pair) {
        const [madeKey, attKey] = pair
        parts[cat].made += stats[madeKey] ?? 0
        parts[cat].att += stats[attKey] ?? 0
      } else {
        sums[cat] = (sums[cat] ?? 0) + (stats[cat] ?? 0)
      }
    }
  }
  if (players === 0) return null
  const out: Record<string, number> = { ...sums }
  for (const [cat, { made, att }] of Object.entries(parts)) {
    out[cat] = att > 0 ? made / att : 0
  }
  return { players, min, categories: out, shooting: parts }
}

/** The player's line in a fetched box, or that he did not play. */
export function myLine(box: GameBoxScore, playerId: string): MyLine {
  for (const team of [box.away, box.home]) {
    const played = [...team.starters, ...team.bench].find(player => player.player_id === playerId)
    if (played) return { kind: 'played', line: played }
    const dnp = team.did_not_play.find(player => player.player_id === playerId)
    if (dnp) return { kind: 'dnp', reason: dnp.reason, jersey: dnp.jersey || '' }
  }
  return { kind: 'out' }
}

/** Keep teammates who share a game together, in the order the rows arrived. */
export function clusterByGame(rows: MyAppearance[]): { game: BoxScoreGame; players: MyAppearance[] }[] {
  const clusters: { game: BoxScoreGame; players: MyAppearance[] }[] = []
  for (const row of rows) {
    const last = clusters[clusters.length - 1]
    if (last && last.game.game_id === row.game.game_id) last.players.push(row)
    else clusters.push({ game: row.game, players: [row] })
  }
  return clusters
}
