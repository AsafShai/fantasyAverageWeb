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
  total_points: number;
  rank?: number;
}

export interface LeagueRankings {
  rankings: RankingStats[];
  categories: string[];
  last_updated: string;
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

export interface TeamDetail {
  team: Team;
  shot_chart: ShotChartStats;
  raw_averages: TeamAverageStats;
  ranking_stats: RankingStats;
  category_ranks: Record<string, number>;
}

export interface LeagueSummary {
  total_teams: number;
  total_games_played: number;
  category_leaders: Record<string, RankingStats>;
  league_averages: AverageStats;
  last_updated: string;
}

export interface HeatmapData {
  teams: Team[];
  categories: string[];
  data: number[][];
  normalized_data: number[][];
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
  gp: number;
}

export interface Player {
  player_name: string;
  pro_team: string;
  positions: string[];
  stats: PlayerStats;
}

export interface TeamPlayers {
  team_id: number;
  players: Player[];
  last_updated: string;
}

