import { fantasyProTeam } from './proTeam'
import type { BoxPlayerLine, BoxScoreGame, GameBoxScore } from '../../types/boxScore'

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

interface RosterPlayer {
  player_id?: number | null
  player_name: string
  pro_team: string
  positions: string[]
}

export type MyLine =
  | { kind: 'played'; line: BoxPlayerLine }
  | { kind: 'dnp'; reason: string }
  | { kind: 'out' }

/** Roster players whose NBA team is on this slate, in tip order then name. */
export function myAppearances(players: RosterPlayer[], games: BoxScoreGame[]): MyAppearance[] {
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

export function groupAppearances(rows: MyAppearance[]): MyGroups {
  const groups: MyGroups = { upcoming: [], live: [], done: [] }
  for (const row of rows) {
    if (row.game.status === 'live') groups.live.push(row)
    else if (row.game.status === 'final') groups.done.push(row)
    else groups.upcoming.push(row)
  }
  return groups
}

/** The player's line in a fetched box, or that he did not play. */
export function myLine(box: GameBoxScore, playerId: string): MyLine {
  for (const team of [box.away, box.home]) {
    const played = [...team.starters, ...team.bench].find(player => player.player_id === playerId)
    if (played) return { kind: 'played', line: played }
    const dnp = team.did_not_play.find(player => player.player_id === playerId)
    if (dnp) return { kind: 'dnp', reason: dnp.reason }
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
