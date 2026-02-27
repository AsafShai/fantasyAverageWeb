import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData, TeamPlayers, Team, TradeSuggestionsResponse, PaginatedPlayers, TimePeriod } from '../../types/api';

export const fantasyApi = createApi({
  reducerPath: 'fantasyApi',
  baseQuery: fetchBaseQuery({
    baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api',
  }),
  tagTypes: ['Rankings', 'Team', 'League', 'Heatmap', 'Shots', 'Teams', 'TradeSuggestions', 'Players'],
  endpoints: (builder) => ({
    getRankings: builder.query<LeagueRankings, { sortBy?: string; order?: string }>({
      query: ({ sortBy, order = 'asc' } = {}) => ({
        url: '/rankings',
        params: { sort_by: sortBy, order },
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
    getHeatmapData: builder.query<HeatmapData, void>({
      query: () => '/analytics/heatmap',
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
} = fantasyApi;