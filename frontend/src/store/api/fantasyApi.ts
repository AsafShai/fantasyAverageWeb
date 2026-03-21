import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData, TeamPlayers, Team, TradeSuggestionsResponse, PaginatedPlayers, TimePeriod, RankingsOverTimeResponse, OverTimeSource, NbaTeamInfo, TeamDepthChart } from '../../types/api';
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
    getTeamDetail: builder.query<TeamDetail, { teamId: number; time_period?: TimePeriod }>({
      query: ({ teamId, time_period = 'season' }) => ({
        url: `/teams/${teamId}`,
        params: { time_period },
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
    getAllPlayers: builder.query<PaginatedPlayers, { page?: number; limit?: number; time_period?: TimePeriod }>({
      query: ({ page = 1, limit = 500, time_period = 'season' } = {}) => ({
        url: '/players',
        params: { page, limit, time_period },
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
} = fantasyApi;