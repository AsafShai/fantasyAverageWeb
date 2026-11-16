/** GET /api/nba/with-without/teams */
export interface WithWithoutTeam {
  team_id: number
  abbr: string
  name: string
  has_out_today: boolean
}

export interface WithWithoutTeams {
  teams: WithWithoutTeam[]
}

export interface WithWithoutGame {
  game_id: string
  date: string
  opp: string
  home: boolean
  result: string
}

/** One game for one player: null = not on the team that day, 0 = on the team
 * and sat, numbers = played (in `line_fields` order). */
export type WithWithoutEntry = number[] | 0 | null

export interface WithWithoutPlayer {
  player_id: number
  name: string
  pos: string
  two_way: boolean
  /** Roster dates come from box scores only: start and end are approximate. */
  approx: boolean
  out_today: { status: string; note: string } | null
  owner: { team_id: number; abbrev: string; name: string } | null
  lines: WithWithoutEntry[]
}

/** GET /api/nba/with-without/{team_id} */
export interface WithWithoutTeamSeason {
  team_id: number
  abbr: string
  name: string
  season: string
  categories: string[]
  reverse_categories: string[]
  line_fields: string[]
  games: WithWithoutGame[]
  players: WithWithoutPlayer[]
}
