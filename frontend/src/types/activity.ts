// Mirrors backend/app/models/activity_models.py (GET /api/league/activity).

export type MoveKind = 'add' | 'drop' | 'waiver' | 'trade_drop' | 'trade'
export type StintExit = 'traded' | 'released' | 'on_roster' | 'season_end'

export interface ActivityTeam {
  team_id: number
  name: string
  abbrev: string
}

export interface ActivityPlayer {
  player_id: number
  name: string
}

export interface ActivityMove {
  id: string
  kind: MoveKind
  at: string
  team_id: number
  other_team_id: number | null
  trade_id: string | null
  added: ActivityPlayer[]
  dropped: ActivityPlayer[]
}

export interface PickedUpAfter {
  team_id: number
  date: string
  games_played: number
}

export interface PlayerStint {
  player_id: number
  name: string
  team_id: number
  start: string
  end: string
  days: number
  games_played: number
  team_games: number
  totals: Record<string, number>
  exit: StintExit
  exit_trade_id: string | null
  picked_up_after: PickedUpAfter | null
}

export interface OpenRosterSpot {
  team_id: number
  added_on: string
  stint: PlayerStint
}

export interface TradeSide {
  team_id: number
  received: PlayerStint[]
}

export interface Trade {
  id: string
  date: string
  accepted_at: string | null
  sides: TradeSide[]
  released_for_trade: ActivityPlayer[]
  open_roster_spot: OpenRosterSpot | null
}

export interface ReleasedPlayer {
  player_id: number
  name: string
  released_by: number
  released_on: string
  games_before_release: number
  stint: PlayerStint
}

export interface LeagueActivity {
  season_id: number
  season_over: boolean
  latest_date: string | null
  categories: string[]
  teams: ActivityTeam[]
  moves: ActivityMove[]
  trades: Trade[]
  released: ReleasedPlayer[]
  last_updated: string
}

export interface LatestMoves {
  teams: ActivityTeam[]
  moves: ActivityMove[]
}
