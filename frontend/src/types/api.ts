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
  category_ranks?: Record<string, number>;
  /** Generic per-category values keyed by category code (e.g. "PTS", "TO") for
   * this league's actual scoring categories. Superset of the fixed fields above
   * for leagues scoring beyond the historical default 8. */
  stats?: Record<string, number>;
}

export interface LeagueRankings {
  averages_rankings: RankingStats[];
  totals_rankings: RankingStats[];
  categories: string[];
  last_updated: string;
  data_date?: string;
  date_range_start?: string;
  date_range_end?: string;
  actual_start_date?: string;
  actual_end_date?: string;
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
  /** See RankingStats.stats */
  stats?: Record<string, number>;
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
  actual_start?: string;
  actual_end?: string;
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
  season_start?: string;
}

export interface HeatmapData {
  teams: Team[];
  categories: string[];
  data: number[][];
  normalized_data: number[][];
  ranks_data?: number[][];
  data_date?: string;
  date_range_start?: string;
  date_range_end?: string;
  actual_start_date?: string;
  actual_end_date?: string;
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
  /** See RankingStats.stats */
  stats?: Record<string, number>;
}

/** Fixed, numeric PlayerStats fields — excludes the generic `stats` dict,
 * for call sites that index PlayerStats dynamically by key (sort columns,
 * comparison tables) where only a plain number makes sense. */
export type PlayerStatKey = Exclude<keyof PlayerStats, 'stats'>

export interface Player {
  player_name: string;
  pro_team: string;
  positions: string[];
  stats: PlayerStats;
  team_id: number;
  status: "ONTEAM" | "FREEAGENT" | "WAIVERS";
  /** ESPN athlete id — used to open /player/:id */
  player_id?: number | null;
  injured?: boolean;
  fantasy_team_name?: string | null;
  season_rating?: number | null;
  last7_rating?: number | null;
  last15_rating?: number | null;
  last30_rating?: number | null;
  has_data?: boolean;
}

export interface PaginatedPlayers {
  players: Player[];
  total_count: number;
  page: number;
  limit: number;
  has_more: boolean;
  actual_start?: string;
  actual_end?: string;
  /** This league's actual scoring categories (see PlayerStats.stats). */
  categories?: string[];
  /** Subset of `categories` where a lower raw value scores better (e.g. "TO"). */
  reverse_categories?: string[];
}

export type ComparisonOperator = "eq" | "gt" | "lt" | "gte" | "lte";

export type TimePeriod = 'season' | 'last_7' | 'last_15' | 'last_30' | 'custom';

export interface CustomDateRange {
  start: string;
  end: string;
}

export interface StatFilter {
  stat: PlayerStatKey;
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
  /** Category -> rank, present only when the league scores categories with no
   *  rk_* field of their own. Null for a fixed-category league. */
  ranks?: Record<string, number> | null;
  gp?: number;
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

export interface DraftPick {
  pick: number;
  round: number;
  team_id: number;
  team_name: string;
  player_name: string;
}

export interface DraftReport {
  picks: DraftPick[];
}

export interface NbaTeamInfo {
  team_id: string;
  abbreviation: string;
  team_name: string;
}

export interface ScheduleCalendarDay {
  date: string;
  slate_size: number;
  high_volume: boolean;
}

export interface ScheduleGame {
  game_id: string;
  date: string;
  opponent_id: number;
  opponent: string;
  opponent_abbreviation: string;
  is_home: boolean;
  rest_days: number | null;
  slate_size: number;
  high_volume: boolean;
}

export interface ScheduleTeam {
  team_id: number;
  abbreviation: string;
  team_name: string;
  games: ScheduleGame[];
  monthly_games: Record<string, number>;
  total_games: number;
  b2b_count: number;
  high_volume_games: number;
  avg_rest_days: number | null;
}

export interface ScheduleResponse {
  season: string;
  high_volume_threshold: number;
  calendar_days: ScheduleCalendarDay[];
  teams: ScheduleTeam[];
  published_games_min: number;
  published_games_max: number;
}

export interface NbaInjury {
  status: string;
}

export interface DepthChartPlayer {
  id: string;
  display_name: string;
  short_name: string;
  injury?: NbaInjury | null;
}

export interface SiteAdp {
  adp: number | null;
  rank: number | null;
  ranking: number | null;
}

export interface ProviderMeta {
  key: string;
  label: string;
  has_adp: boolean;
  has_rankings: boolean;
  fetched_at: string | null;
  source_url: string | null;
  player_count: number;
  stale: boolean;
}

export interface LastYearStats {
  gp: number;
  fg_pct: number;
  ft_pct: number;
  ppg: number;
  rpg: number;
  apg: number;
  spg: number;
  bpg: number;
  three_pm: number;
}

export interface AdpPlayer {
  id: string;
  espn_id: number | null;
  name: string;
  team: string | null;
  team_abbr: string | null;
  photo_url: string | null;
  positions: string[];
  espn: SiteAdp;
  fantrax: SiteAdp;
  sleeper: SiteAdp;
  yahoo: SiteAdp;
  blend: number | null;
  blend_rank: number | null;
  spread: number | null;
  ranking_blend: number | null;
  ranking_blend_rank: number | null;
  ranking_spread: number | null;
  last_year?: LastYearStats | null;
  projection?: LastYearStats | null;
}

export interface AdpIndexPlayer {
  id: string;
  espn_id: number | null;
  name: string;
  team_abbr: string | null;
  positions: string[];
  blend: number | null;
  blend_rank: number | null;
  ranking_blend: number | null;
  ranking_blend_rank: number | null;
}

export interface AdpIndexResponse {
  season_label: string;
  updated_at: string;
  teams: string[];
  players: AdpIndexPlayer[];
  total: number;
}

export interface AdpResponse {
  season_label: string;
  updated_at: string;
  last_year_season?: string | null;
  projection_season?: string | null;
  sources: Record<string, string>;
  providers?: ProviderMeta[];
  players: AdpPlayer[];
  teams?: string[];
  total?: number;
  page?: number;
  page_size?: number;
  total_pages?: number;
  offset?: number;
}

export type AdpSite = "espn" | "fantrax" | "sleeper" | "yahoo";

/** Which of the two parallel data types a draft view is showing. */
export type AdpMetric = "adp" | "rank";

export interface AdpQueryArgs {
  page?: number;
  page_size?: number;
  sort?: string;
  sort_dir?: "asc" | "desc";
  q?: string;
  team?: string;
  pos?: string;
  ids?: string;
  ranked_only?: boolean;
  sites?: string;
  rank_sites?: string;
  metric?: AdpMetric;
}

export interface AdpIndexQueryArgs {
  sites?: string;
  rank_sites?: string;
  metric?: AdpMetric;
}

export interface NbaPlayerBio {
  id: string;
  display_name: string;
  team: string;
  team_abbr: string;
  conference: string;
  division: string;
  position: string;
  photo_url: string | null;
  height: string | null;
  nationality: string | null;
  age: number | null;
  jersey_number: string | null;
}

export interface NbaPlayerStatsResponse {
  player_id: number;
  totals: PlayerStats;
  averages: PlayerStats;
  has_data: boolean;
  actual_start?: string | null;
  actual_end?: string | null;
}

export interface DepthChartPosition {
  abbreviation: string;
  display_name: string;
  players: DepthChartPlayer[];
}

export interface TeamDepthChart {
  team_id: string;
  team_name: string;
  team_abbreviation: string;
  team_logo: string;
  record: string;
  positions: DepthChartPosition[];
}

export interface DefRanks {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  fg_pct: number;
}

export interface DefValues {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  three_pm: number;
  fg_pct: number;
}

export type ProjectionStatus = 'green' | 'amber' | 'red';

export interface ProjectionStats {
  pts: number;
  reb: number;
  ast: number;
  three_pm: number;
  stl: number;
  blk: number;
  fgm: number;
  fga: number;
  fg_pct: number;
  ftm: number;
  fta: number;
  ft_pct: number;
}

export interface Projection {
  default_minutes: number;
  status: ProjectionStatus;
  reason: string;
  stats: ProjectionStats | null;
}

export interface PlayerNextGameProjection {
  player_name: string;
  team: string;
  game_date: string | null;
  opponent: string | null;
  is_home: boolean;
  scheduled: boolean;
  default_minutes: number;
  status: ProjectionStatus;
  reason: string;
  stats: ProjectionStats | null;
}

export interface PlayerMatchup {
  player_name: string;
  pro_team: string;
  opponent: string;
  is_home: boolean;
  pace: number;
  league_avg_pace: number;
  positions: string[];
  def_ranks: DefRanks;
  def_values: DefValues;
  league_avg_def_values: DefValues;
  projection: Projection | null;
  game_date: string | null;
  on_depth_chart: boolean;
  injury_status: string | null;
}

export interface PlayerStoreSummary {
  player_id: number;
  player_name: string;
  team_abbr: string;
  games_count: number;
  eligible: boolean;
}

export interface PlayersListResponse {
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

export interface MinutesMoverItem {
  player_id: number;
  player_name: string;
  pro_team: string;
  position: string;
  fantasy_status: string;
  games_last_15d: number;
  season_mpg: number;
  l5_mpg: number;
  delta_mpg: number;
  season_gp: number;
  window_gp: number;
  low_sample: boolean;
}

export interface MinutesResponse {
  items: MinutesMoverItem[];
  window_days: number;
  last_updated: string;
}

export interface UsageRoleItem {
  player_id: number;
  player_name: string;
  pro_team: string;
  position: string;
  fantasy_status: string;
  games_last_15d: number;
  season_usg: number;
  l5_usg: number;
  delta_usg: number;
  season_mpg: number;
  l5_mpg: number;
  delta_mpg: number;
  season_gp: number;
  window_gp: number;
  role_badge: string | null;
}

export interface UsageResponse {
  items: UsageRoleItem[];
  window_days: number;
  last_updated: string;
}

export type RegressionStat = '3P%' | 'FT%' | 'FG%';

export interface RegressionStatItem {
  stat: RegressionStat;
  current_pct: number;
  baseline_pct: number;
  dev: number;
  attempts_per_game: number;
  drift_score: number;
  window_pct: number | null;
  window_attempts: number;
  z: number | null;
}

/** 'season' compares this season to prior seasons; 'form' compares the recency
 * window to a baseline that excludes it. Same fields, different meanings — see
 * RegressionStatItem in backend/app/models/trend_models.py. */
export type RegressionMode = 'season' | 'form';

export interface RegressionPlayerGroup {
  player_id: number;
  player_name: string;
  pro_team: string;
  position: string;
  fantasy_status: string;
  games_last_15d: number;
  stats: RegressionStatItem[];
}

export interface RegressionResponse {
  items: RegressionPlayerGroup[];
  window_days: number;
  baseline_seasons: number;
  mode: RegressionMode;
  last_updated: string;
}

export interface GameLogEntry {
  game_date: string;
  matchup: string;
  min: number;
  usg: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  fg3m: number;
  fg3a: number;
}

export interface GameLogResponse {
  player_id: number;
  player_name: string;
  season: string;
  window_days: number;
  window_start: string;
  season_gp: number;
  season_mpg: number;
  season_usg: number;
  season_pct: Partial<Record<RegressionStat, number>>;
  baseline_pct: Partial<Record<RegressionStat, number>>;
  league_pct: Partial<Record<RegressionStat, number>>;
  league_usg: number | null;
  baseline_seasons: number;
  games: GameLogEntry[];
}
