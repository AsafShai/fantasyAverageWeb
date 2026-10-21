import { useMemo } from 'react';
import { useGetTeamsListQuery, useGetTeamDetailQuery, useGetAllPlayersQuery } from '../store/api/fantasyApi';
import type { Team, TeamDetail, Player, TimePeriod, CustomDateRange } from '../types/api';
import type { TradeMode } from './useTradeState';
import { DEFAULT_CATEGORIES } from '../utils/playerRankings';
import { computePlayerValues, playerValueLookup, type PlayerValueLookup } from '../pages/Trade/utils/playerValues';

interface UseTradeDataReturn {
  teams: Team[];
  isLoadingTeams: boolean;
  teamsError: unknown;

  teamAData: TeamDetail | undefined;
  isFetchingTeamA: boolean;
  teamAError: unknown;

  teamBData: TeamDetail | undefined;
  isFetchingTeamB: boolean;
  teamBError: unknown;

  freeAgents: Player[];
  isFetchingFreeAgents: boolean;
  freeAgentsError: unknown;

  /** Rank and z-score of a player among every player in the same period. */
  playerValue: PlayerValueLookup;
}

function withoutNoDataPlayers(team: TeamDetail | undefined): TeamDetail | undefined {
  if (!team?.players) return team;
  return { ...team, players: team.players.filter(p => p.has_data !== false) };
}

export const useTradeData = (
  teamA: Team | null,
  teamB: Team | null,
  tradeMode: TradeMode,
  timePeriod: TimePeriod = 'season',
  customRange: CustomDateRange | null = null
): UseTradeDataReturn => {
  const { data: teams = [], isLoading: isLoadingTeams, error: teamsError } = useGetTeamsListQuery();

  const customParams = timePeriod === 'custom' && customRange
    ? { start: customRange.start, end: customRange.end }
    : {};

  const {
    data: teamADataRaw,
    isFetching: isFetchingTeamA,
    error: teamAError
  } = useGetTeamDetailQuery({ teamId: teamA?.team_id || 0, time_period: timePeriod, ...customParams }, { skip: !teamA });

  const {
    data: teamBDataRaw,
    isFetching: isFetchingTeamB,
    error: teamBError
  } = useGetTeamDetailQuery({ teamId: teamB?.team_id || 0, time_period: timePeriod, ...customParams }, { skip: !teamB || tradeMode === 'freeAgent' });

  const {
    data: allPlayersData,
    isFetching: isFetchingAllPlayers,
    error: allPlayersError
  } = useGetAllPlayersQuery({ page: 1, limit: 1200, time_period: timePeriod, ...customParams });

  const teamAData = useMemo(() => withoutNoDataPlayers(teamADataRaw), [teamADataRaw]);
  const teamBData = useMemo(() => withoutNoDataPlayers(teamBDataRaw), [teamBDataRaw]);

  const freeAgents = useMemo(() => {
    if (tradeMode !== 'freeAgent' || !allPlayersData?.players) return [];
    return allPlayersData.players.filter(
      player => player.has_data !== false && (player.status === 'FREEAGENT' || player.status === 'WAIVERS')
    );
  }, [tradeMode, allPlayersData]);

  // Every player in the period, also behind the rank and z-score shown for
  // each player in the trade (team mode included).
  const playerValue = useMemo(() => {
    const categories = allPlayersData?.categories?.length ? allPlayersData.categories : DEFAULT_CATEGORIES;
    const values = computePlayerValues(
      allPlayersData?.players ?? [], categories, new Set(allPlayersData?.reverse_categories ?? []),
    );
    return playerValueLookup(values);
  }, [allPlayersData]);

  return {
    teams,
    isLoadingTeams,
    teamsError,
    teamAData,
    isFetchingTeamA,
    teamAError,
    teamBData,
    isFetchingTeamB,
    teamBError,
    freeAgents,
    isFetchingFreeAgents: isFetchingAllPlayers,
    freeAgentsError: allPlayersError,
    playerValue,
  };
};
