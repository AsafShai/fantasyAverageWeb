export interface Team {
  team_id: number;
  team_name: string;
}

export interface RankingStats {
  team: Team;
  fg_percentage: number;
  ft_percentage: number;
  three_pm: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
  pts: number;
  gp: number;
  total_points: number;
  rank?: number;
}

export interface LeagueRankings {
  rankings: RankingStats[];
  categories: string[];
  last_updated: string;
  data_date?: string;
}

export interface ShotChartStats {
  team: Team;
  fgm: number;
  fga: number;
  fg_percentage: number;
  ftm: number;
  fta: number;
  ft_percentage: number;
  gp: number;
}

export interface AverageStats {
  fg_percentage: number;
  ft_percentage: number;
  three_pm: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
  pts: number;
  gp: number;
}

export interface TeamAverageStats extends AverageStats {
  team: Team;
}

export interface SlotUsage {
  games_used: number;
  cap: number;
  remaining: number;
}

export interface TeamDetail {
  team: Team;
  espn_url: string;
  players?: Player[];
  shot_chart: ShotChartStats;
  raw_averages: TeamAverageStats;
  ranking_stats: RankingStats;
  category_ranks: Record<string, number>;
  slot_usage: Record<string, SlotUsage>;
  data_date?: string;
}

export interface LeagueSummary {
  total_teams: number;
  total_games_played: number;
  nba_avg_pace?: number;
  nba_game_days_left?: number;
  category_leaders: Record<string, RankingStats>;
  league_averages: AverageStats;
  last_updated: string;
  data_date?: string;
}

export interface HeatmapData {
  teams: Team[];
  categories: string[];
  data: number[][];
  normalized_data: number[][];
  ranks_data?: number[][];
  data_date?: string;
}

export interface TeamShotStats {
  team: Team;
  fgm: number;
  fga: number;
  fg_percentage: number;
  ftm: number;
  fta: number;
  ft_percentage: number;
  gp: number;
}

export interface LeagueShotsData {
  shots: TeamShotStats[];
  last_updated: string;
  data_date?: string;
}

export interface PlayerStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg_percentage: number;
  ft_percentage: number;
  three_pm: number;
  minutes: number;
  gp: number;
}

export interface Player {
  player_name: string;
  pro_team: string;
  positions: string[];
  stats: PlayerStats;
  team_id: number;
  status: "ONTEAM" | "FREEAGENT" | "WAIVERS";
}

export interface PaginatedPlayers {
  players: Player[];
  total_count: number;
  page: number;
  limit: number;
  has_more: boolean;
}

export type ComparisonOperator = "eq" | "gt" | "lt" | "gte" | "lte";

export type TimePeriod = 'season' | 'last_7' | 'last_15' | 'last_30';

export interface StatFilter {
  stat: keyof PlayerStats;
  operator: ComparisonOperator;
  value: number;
}

export interface PlayerFilters {
  search?: string;
  positions?: string[];
  status?: string[];
  team_id?: number | null;
  stat_filters?: StatFilter[];
}

export interface TeamPlayers {
  team_id: number;
  players: Player[];
  last_updated: string;
}

export interface TradeSuggestion {
  opponent_team: Team;
  players_to_give: Player[];
  players_to_receive: Player[];
  reasoning: string;
}

export interface TradeSuggestionsResponse {
  user_team: Team;
  trade_suggestions: TradeSuggestion[];
}

export type OverTimeSource = 'rankings_avg' | 'rankings_totals' | 'snapshot' | 'averages';

export interface TeamTimeSeriesPoint {
  date: string;
  team_id: number;
  team_name: string;
  rk_fg_pct?: number;
  rk_ft_pct?: number;
  rk_three_pm?: number;
  rk_reb?: number;
  rk_ast?: number;
  rk_stl?: number;
  rk_blk?: number;
  rk_pts?: number;
  rk_total?: number;
  fg_pct?: number;
  ft_pct?: number;
  three_pm?: number;
  reb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  pts?: number;
}

export interface RankingsOverTimeResponse {
  data: TeamTimeSeriesPoint[];
}

