export interface RankingStats {
  team: string;
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
  team: string;
  fgm: number;
  fga: number;
  fg_percentage: number;
  ftm: number;
  fta: number;
  ft_percentage: number;
  gp: number;
}

export interface RawAverageStats {
  team: string;
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

export interface TeamDetail {
  team: string;
  shot_chart: ShotChartStats;
  raw_averages: RawAverageStats;
  ranking_stats: RankingStats;
  category_ranks: Record<string, number>;
}

export interface LeagueSummary {
  total_teams: number;
  total_games_played: number;
  category_leaders: Record<string, RankingStats>;
  league_averages: RawAverageStats;
  last_updated: string;
}

export interface HeatmapData {
  teams: string[];
  categories: string[];
  data: number[][];
  normalized_data: number[][];
}

export interface TeamShotStats {
  team: string;
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

