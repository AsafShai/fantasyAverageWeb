import { useMemo } from 'react';
import { useGetTeamsListQuery, useGetTeamPlayersQuery, useGetAllPlayersQuery } from '../store/api/fantasyApi';
import type { Team, TeamPlayers, Player } from '../types/api';
import type { TradeMode } from './useTradeState';

interface UseTradeDataReturn {
  teams: Team[];
  isLoadingTeams: boolean;
  teamsError: unknown;

  teamAData: TeamPlayers | undefined;
  isFetchingTeamA: boolean;
  teamAError: unknown;

  teamBData: TeamPlayers | undefined;
  isFetchingTeamB: boolean;
  teamBError: unknown;

  freeAgents: Player[];
  isFetchingFreeAgents: boolean;
  freeAgentsError: unknown;
}

export const useTradeData = (
  teamA: Team | null,
  teamB: Team | null,
  tradeMode: TradeMode
): UseTradeDataReturn => {
  const { data: teams = [], isLoading: isLoadingTeams, error: teamsError } = useGetTeamsListQuery();
  
  const { 
    data: teamAData, 
    isFetching: isFetchingTeamA,
    error: teamAError 
  } = useGetTeamPlayersQuery(teamA?.team_id || 0, { skip: !teamA });
  
  const {
    data: teamBData,
    isFetching: isFetchingTeamB,
    error: teamBError
  } = useGetTeamPlayersQuery(teamB?.team_id || 0, { skip: !teamB || tradeMode === 'freeAgent' });

  const {
    data: allPlayersData,
    isFetching: isFetchingAllPlayers,
    error: allPlayersError
  } = useGetAllPlayersQuery({ page: 1, limit: 500 }, { skip: tradeMode !== 'freeAgent' });

  const freeAgents = useMemo(() => {
    if (tradeMode !== 'freeAgent' || !allPlayersData?.players) return [];
    return allPlayersData.players.filter(
      player => player.status === 'FREEAGENT' || player.status === 'WAIVERS'
    );
  }, [tradeMode, allPlayersData]);

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
  };
};