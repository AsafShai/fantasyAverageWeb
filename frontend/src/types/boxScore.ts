export type GameStatus = 'scheduled' | 'live' | 'final'

export interface BoxTeamSide {
  team_id: string
  name: string
  short_name: string
  abbreviation: string
  logo: string
  color: string
  record: string
  score: number | null
  winner: boolean
}

export interface BoxScoreGame {
  game_id: string
  status: GameStatus
  status_detail: string
  start_time: string
  broadcast: string
  venue: string
  away: BoxTeamSide
  home: BoxTeamSide
}

export interface BoxScoreboard {
  date: string
  games: BoxScoreGame[]
}

export interface NbaSeasonWindow {
  start: string
  end: string
}

export interface BoxPlayerLine {
  player_id: string
  name: string
  jersey: string
  position: string
  ejected: boolean
  /** True only while the game is live and this player is on the floor. */
  on_court: boolean
  min: string
  pts: string
  fg: string
  fg3: string
  ft: string
  reb: string
  ast: string
  tov: string
  stl: string
  blk: string
  oreb: string
  dreb: string
  pf: string
  plus_minus: string
}

export interface BoxDidNotPlay {
  player_id: string
  name: string
  jersey: string
  position: string
  reason: string
}

export interface BoxTeamTotals {
  min: string
  pts: string
  fg: string
  fg3: string
  ft: string
  reb: string
  ast: string
  tov: string
  stl: string
  blk: string
  oreb: string
  dreb: string
  pf: string
  plus_minus: string
}

export interface BoxShooting {
  fg_pct: string
  fg3_pct: string
  ft_pct: string
  points_in_paint: string
  fast_break_points: string
  turnover_points: string
  largest_lead: string
}

export interface BoxTeamBox extends BoxTeamSide {
  linescores: string[]
  starters: BoxPlayerLine[]
  bench: BoxPlayerLine[]
  did_not_play: BoxDidNotPlay[]
  totals: BoxTeamTotals
  shooting: BoxShooting
}

export interface GameBoxScore {
  game_id: string
  status: GameStatus
  status_detail: string
  start_time: string
  broadcast: string
  venue: string
  attendance?: number | null
  periods: string[]
  away: BoxTeamBox
  home: BoxTeamBox
}

/** One non-DNP line of the slate, as the server sends it. */
export interface SlateLine {
  player_id: string
  name: string
  position: string
  team_abbr: string
  team_logo: string
  opponent_abbr: string
  is_home: boolean
  game_id: string
  game_status: GameStatus
  min: string
  pts: string
  reb: string
  ast: string
  stl: string
  blk: string
  tov: string
  fg: string
  fg3: string
  ft: string
  /** The line's value per category code (PTS, FG%, TO, ...) plus MIN. */
  stats: Record<string, number>
  /** Fantasy team abbreviation on the night of the game; null = free agent. */
  fantasy_team: string | null
  fantasy_team_name: string | null
}

/** A line with its Z: the Player Rankings value of that night (computed in
 * the browser by computePlayerRankings, see slateValues.ts). */
export interface SlatePlayerValue extends SlateLine {
  z: number
}

export interface SlateValues {
  date: string
  /** Every game on the slate is final. */
  complete: boolean
  games_counted: number
  categories: string[]
  reverse_categories: string[]
  players: SlateLine[]
}
