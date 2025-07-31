import { useGetTeamsListQuery, useGetTeamPlayersQuery } from '../store/api/fantasyApi';
import type { Team, TeamPlayers } from '../types/api';

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
}

export const useTradeData = (teamA: Team | null, teamB: Team | null): UseTradeDataReturn => {
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
  } = useGetTeamPlayersQuery(teamB?.team_id || 0, { skip: !teamB });

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
  };
};