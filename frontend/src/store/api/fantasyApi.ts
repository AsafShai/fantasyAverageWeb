import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData, TeamPlayers, Team, TradeSuggestionsResponse, PaginatedPlayers, TimePeriod, RankingsOverTimeResponse, OverTimeSource, NbaTeamInfo, TeamDepthChart, PlayerMatchup, ProjectionStats, PlayersListResponse, PlayerStoreState, TeamsListResponse, TeamStoreState, DraftReport, MinutesResponse, UsageResponse, RegressionResponse, GameLogResponse } from '../../types/api';
import type { EstimatorResults } from '../../types/estimator';

export const fantasyApi = createApi({
  reducerPath: 'fantasyApi',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api',
  }),
  tagTypes: ['Rankings', 'Team', 'League', 'Heatmap', 'Shots', 'Teams', 'TradeSuggestions', 'Players', 'Estimator'],
  endpoints: (builder) => ({
    getRankings: builder.query<LeagueRankings, { sortBy?: string; order?: string; startDate?: string; endDate?: string }>({
      query: ({ sortBy, order = 'asc', startDate, endDate } = {}) => ({
        url: '/rankings',
        params: { sort_by: sortBy, order, ...(startDate ? { start_date: startDate } : {}), ...(endDate ? { end_date: endDate } : {}) },
      }),
      providesTags: ['Rankings'],
    }),
    getTeamDetail: builder.query<TeamDetail, { teamId: number; time_period?: TimePeriod; start?: string; end?: string }>({
      query: ({ teamId, time_period = 'season', start, end }) => ({
        url: `/teams/${teamId}`,
        params: { time_period, ...(start ? { start } : {}), ...(end ? { end } : {}) },
      }),
      keepUnusedDataFor: 300,
    }),
    getLeagueSummary: builder.query<LeagueSummary, void>({
      query: () => '/league/summary',
      providesTags: ['League'],
    }),
    getHeatmapData: builder.query<HeatmapData, { startDate?: string; endDate?: string }>({
      query: ({ startDate, endDate } = {}) => ({
        url: '/analytics/heatmap',
        params: { ...(startDate ? { start_date: startDate } : {}), ...(endDate ? { end_date: endDate } : {}) },
      }),
      providesTags: ['Heatmap'],
    }),
    // getCategoryRankings: builder.query<any, string>({
    //   query: (category) => `/rankings/category/${category}`,
    //   providesTags: ['Rankings'],
    // }),
    getLeagueShots: builder.query<LeagueShotsData, void>({
      query: () => '/league/shots',
      providesTags: ['Shots'],
    }),
    getTeamsList: builder.query<Team[], void>({
      query: () => '/teams/',
      providesTags: ['Teams'],
    }),
    getTeamPlayers: builder.query<TeamPlayers, number>({
      query: (teamId) => `/teams/${teamId}/players`,
      providesTags: ['Team'],
    }),
    getTradeSuggestions: builder.query<TradeSuggestionsResponse, number>({
      query: (teamId) => `/trades/suggestions/${teamId}`,
      keepUnusedDataFor: 0,
    }),
    getAllPlayers: builder.query<PaginatedPlayers, { page?: number; limit?: number; time_period?: TimePeriod; start?: string; end?: string }>({
      query: ({ page = 1, limit = 500, time_period = 'season', start, end } = {}) => ({
        url: '/players',
        params: { page, limit, time_period, ...(start ? { start } : {}), ...(end ? { end } : {}) },
      }),
      keepUnusedDataFor: 300,
    }),
    getRankingsOverTime: builder.query<RankingsOverTimeResponse, { source?: OverTimeSource; teamIds?: number[] }>({
      query: ({ source = 'rankings_avg', teamIds } = {}) => ({
        url: '/analytics/over-time',
        params: { source, ...(teamIds && teamIds.length > 0 ? { team_ids: teamIds.join(',') } : {}) },
      }),
    }),
    getEstimatorResults: builder.query<EstimatorResults, void>({
      query: () => '/estimator/results',
      providesTags: ['Estimator'],
    }),
    getNbaTeamsList: builder.query<NbaTeamInfo[], void>({
      query: () => '/nba-teams/',
    }),
    getNbaTeamDepthChart: builder.query<TeamDepthChart, string>({
      query: (teamId) => `/nba-teams/${teamId}/depthchart`,
    }),
    getMatchupsToday: builder.query<PlayerMatchup[], string | void>({
      query: (date) => date ? `/matchups/today?date=${date}` : '/matchups/today',
    }),
    getMatchupDates: builder.query<string[], void>({
      query: () => '/matchups/dates',
    }),
    getUpcomingDates: builder.query<string[], void>({
      query: () => '/matchups/upcoming-dates',
    }),
    getCurrentSlateDate: builder.query<string | null, void>({
      query: () => '/matchups/current-slate-date',
    }),
    predictProjection: builder.mutation<{ stats: ProjectionStats }, { player_name: string; opponent: string; is_home: boolean; minutes: number }>({
      query: (body) => ({ url: '/projections/predict', method: 'POST', body }),
    }),
    getFeatureStorePlayers: builder.query<PlayersListResponse, void>({
      query: () => '/feature-store/players',
    }),
    getFeatureStorePlayerState: builder.query<PlayerStoreState, number>({
      query: (playerId) => `/feature-store/players/${playerId}/state`,
    }),
    getFeatureStoreTeams: builder.query<TeamsListResponse, void>({
      query: () => '/feature-store/teams',
    }),
    getFeatureStoreTeamState: builder.query<TeamStoreState, number>({
      query: (teamId) => `/feature-store/teams/${teamId}/state`,
    }),
    getDraftReport: builder.query<DraftReport, void>({
      query: () => '/league/draft-report',
      keepUnusedDataFor: 3600,
    }),
    getTrendsMinutes: builder.query<MinutesResponse, { windowDays?: number }>({
      query: ({ windowDays = 15 } = {}) => ({ url: '/trends/minutes', params: { window_days: windowDays } }),
    }),
    getTrendsUsage: builder.query<UsageResponse, { windowDays?: number }>({
      query: ({ windowDays = 15 } = {}) => ({ url: '/trends/usage', params: { window_days: windowDays } }),
    }),
    getTrendsRegression: builder.query<RegressionResponse, { windowDays?: number; baselineSeasons?: number }>({
      query: ({ windowDays = 15, baselineSeasons = 2 } = {}) => ({
        url: '/trends/regression',
        params: { window_days: windowDays, baseline_seasons: baselineSeasons },
      }),
    }),
    getTrendGameLog: builder.query<GameLogResponse, { playerId: number; windowDays?: number; baselineSeasons?: number }>({
      query: ({ playerId, windowDays = 15, baselineSeasons = 2 }) => ({
        url: `/trends/player/${playerId}/gamelog`,
        params: { window_days: windowDays, baseline_seasons: baselineSeasons },
      }),
      keepUnusedDataFor: 600,
    }),
  }),
});

export const {
  useGetRankingsQuery,
  useGetTeamDetailQuery,
  useGetLeagueSummaryQuery,
  useGetHeatmapDataQuery,
  // useGetCategoryRankingsQuery,
  useGetLeagueShotsQuery,
  useGetTeamsListQuery,
  useGetTeamPlayersQuery,
  useGetTradeSuggestionsQuery,
  useGetAllPlayersQuery,
  useGetRankingsOverTimeQuery,
  useGetEstimatorResultsQuery,
  useGetNbaTeamsListQuery,
  useGetNbaTeamDepthChartQuery,
  useGetMatchupsTodayQuery,
  useGetMatchupDatesQuery,
  useGetUpcomingDatesQuery,
  useGetCurrentSlateDateQuery,
  usePredictProjectionMutation,
  useGetFeatureStorePlayersQuery,
  useGetFeatureStorePlayerStateQuery,
  useGetFeatureStoreTeamsQuery,
  useGetFeatureStoreTeamStateQuery,
  useGetDraftReportQuery,
  useGetTrendsMinutesQuery,
  useGetTrendsUsageQuery,
  useGetTrendsRegressionQuery,
  useGetTrendGameLogQuery,
} = fantasyApi;
