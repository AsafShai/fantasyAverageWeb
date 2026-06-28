export interface StatCell {
  value: number;
  low?: number | null;
  high?: number | null;
}

export interface SimGame {
  game_id: string;
  team_id: number;
  team_abbr: string;
  opponent_team_id: number;
  opponent_abbr: string;
  matchup: string;
}

export interface SimState {
  season: string;
  current_date: string | null;
  next_game_day: string | null;
  day_index: number;
  total_days: number;
  finished: boolean;
  num_games: number;
  games: SimGame[];
}

export interface PlayerPrediction {
  player_id: number;
  player_name: string;
  team_id: number;
  team_abbr: string;
  opponent_team_id: number;
  opponent_abbr: string;
  is_home: boolean;
  minutes: number;
  default_minutes: number;
  eligible: boolean;
  status: 'green' | 'orange' | 'red';
  reason: string;
  stats: Record<string, StatCell>;
}

export interface EvalRow {
  player_id: number;
  player_name: string;
  team_abbr: string;
  opponent_abbr: string;
  is_home: boolean;
  real_minutes: number;
  eligible: boolean;
  reason: string;
  predicted: Record<string, number>;
  actual: Record<string, number>;
}

export interface LastResults {
  played_date: string | null;
  evaluations: EvalRow[];
}

export interface UpcomingResponse {
  state: SimState;
  predictions: PlayerPrediction[];
  last_results?: LastResults | null;
  resid_sigma?: Record<string, number>;
}

export interface AdvanceResponse {
  played_date: string | null;
  evaluations: EvalRow[];
  state: SimState;
}

export interface PlayerStoreSummary {
  player_id: number;
  player_name: string;
  team_abbr: string;
  games_count: number;
  eligible: boolean;
}

export interface PlayersListResponse {
  current_date: string | null;
  next_game_day: string | null;
  players: PlayerStoreSummary[];
}

export interface PlayerStoreState {
  player_id: number;
  player_name: string;
  team_abbr: string;
  position: string;
  last_game_date: string | null;
  games_count: number;
  eligible: boolean;
  features: Record<string, number | null>;
}

export interface TeamSummary {
  team_id: number;
  team_abbr: string;
}

export interface TeamsListResponse {
  teams: TeamSummary[];
}

export interface TeamStoreState {
  team_id: number;
  team_abbr: string;
  own: Record<string, number | null>;
  allowed: Record<string, number | null>;
}
