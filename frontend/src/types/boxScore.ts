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

export interface BoxPlayerLine {
  player_id: string
  name: string
  position: string
  ejected: boolean
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
