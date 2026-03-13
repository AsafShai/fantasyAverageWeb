export interface TeamPrediction {
  team_id: number;
  team_name: string;
  as_of_date: string;
  projected_total_gp: number;
  estimated_final_fg_pct: number;
  estimated_final_ft_pct: number;
  estimated_final_three_pm: number;
  estimated_final_reb: number;
  estimated_final_ast: number;
  estimated_final_stl: number;
  estimated_final_blk: number;
  estimated_final_pts: number;
  variance_fg_pct: number;
  variance_ft_pct: number;
  variance_three_pm: number;
  variance_reb: number;
  variance_ast: number;
  variance_stl: number;
  variance_blk: number;
  variance_pts: number;
  nba_avg_pace: number;
}

export interface TeamRanking {
  team_id: number;
  team_name: string;
  rank: number;
  total_expected_pts: number;
  expected_pts_fg_pct: number;
  expected_pts_ft_pct: number;
  expected_pts_three_pm: number;
  expected_pts_reb: number;
  expected_pts_ast: number;
  expected_pts_stl: number;
  expected_pts_blk: number;
  expected_pts_pts: number;
  projected_total_gp: number;
}

export interface TeamRankProbability {
  team_id: number;
  team_name: string;
  rank: number;
  prob: number;
}

export interface EstimatorResults {
  as_of_date: string;
  elapsed_ms: number;
  predictions: TeamPrediction[];
  rankings: TeamRanking[];
  rank_probabilities: TeamRankProbability[];
}
