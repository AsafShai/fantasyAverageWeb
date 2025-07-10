import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { LeagueRankings, TeamDetail, LeagueSummary, HeatmapData, LeagueShotsData } from '../../types/api';

export const fantasyApi = createApi({
  reducerPath: 'fantasyApi',
  baseQuery: fetchBaseQuery({
    baseUrl: 'http://localhost:8000/api',
  }),
  tagTypes: ['Rankings', 'Team', 'League', 'Heatmap', 'Shots'],
  endpoints: (builder) => ({
    getRankings: builder.query<LeagueRankings, { sortBy?: string; order?: string }>({
      query: ({ sortBy, order = 'desc' } = {}) => ({
        url: '/rankings',
        params: { sort_by: sortBy, order },
      }),
      providesTags: ['Rankings'],
    }),
    getTeamDetail: builder.query<TeamDetail, string>({
      query: (teamName) => `/teams/${encodeURIComponent(teamName)}`,
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
    getCategoryRankings: builder.query<any, string>({
      query: (category) => `/rankings/category/${category}`,
      providesTags: ['Rankings'],
    }),
    getLeagueShots: builder.query<LeagueShotsData, void>({
      query: () => '/league/shots',
      providesTags: ['Shots'],
    }),
  }),
});

export const {
  useGetRankingsQuery,
  useGetTeamDetailQuery,
  useGetLeagueSummaryQuery,
  useGetHeatmapDataQuery,
  useGetCategoryRankingsQuery,
  useGetLeagueShotsQuery,
} = fantasyApi;