import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData, TeamPlayers, Team } from '../../types/api';

export const fantasyApi = createApi({
  reducerPath: 'fantasyApi',
  baseQuery: fetchBaseQuery({
    baseUrl: 'http://localhost:8000/api',
  }),
  tagTypes: ['Rankings', 'Team', 'League', 'Heatmap', 'Shots', 'Teams'],
  endpoints: (builder) => ({
    getRankings: builder.query<LeagueRankings, { sortBy?: string; order?: string }>({
      query: ({ sortBy, order = 'asc' } = {}) => ({
        url: '/rankings',
        params: { sort_by: sortBy, order },
      }),
      providesTags: ['Rankings'],
    }),
    getTeamDetail: builder.query<TeamDetail, number>({
      query: (teamId) => `/teams/${teamId}`,
      providesTags: ['Team'],
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
} = fantasyApi;