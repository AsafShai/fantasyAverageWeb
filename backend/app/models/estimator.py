from pydantic import BaseModel
from datetime import date


class TeamPrediction(BaseModel):
    team_id: int
    team_name: str
    as_of_date: date
    projected_total_gp: float
    estimated_final_fg_pct: float
    estimated_final_ft_pct: float
    estimated_final_three_pm: float
    estimated_final_reb: float
    estimated_final_ast: float
    estimated_final_stl: float
    estimated_final_blk: float
    estimated_final_pts: float
    variance_fg_pct: float
    variance_ft_pct: float
    variance_three_pm: float
    variance_reb: float
    variance_ast: float
    variance_stl: float
    variance_blk: float
    variance_pts: float
    nba_avg_pace: float


class TeamRanking(BaseModel):
    team_id: int
    team_name: str
    rank: int
    total_expected_pts: float
    expected_pts_fg_pct: float
    expected_pts_ft_pct: float
    expected_pts_three_pm: float
    expected_pts_reb: float
    expected_pts_ast: float
    expected_pts_stl: float
    expected_pts_blk: float
    expected_pts_pts: float
    projected_total_gp: float


class TeamRankProbability(BaseModel):
    team_id: int
    team_name: str
    rank: int
    prob: float


class EstimatorResults(BaseModel):
    predictions: list[TeamPrediction]
    rankings: list[TeamRanking]
    rank_probabilities: list[TeamRankProbability]
    as_of_date: str
    elapsed_ms: float
