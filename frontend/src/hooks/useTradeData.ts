import { useGetTeamsListQuery, useGetTeamPlayersQuery } from '../store/api/fantasyApi';

interface UseTradeDataReturn {
  // Teams data
  teams: string[];
  isLoadingTeams: boolean;
  teamsError: unknown;
  
  // Team A data
  teamAData: { players: any[] } | undefined;
  isLoadingTeamA: boolean;
  teamAError: unknown;
  
  // Team B data
  teamBData: { players: any[] } | undefined;
  isLoadingTeamB: boolean;
  teamBError: unknown;
}

export const useTradeData = (teamA: string, teamB: string): UseTradeDataReturn => {
  // API queries
  const { data: teams = [], isLoading: isLoadingTeams, error: teamsError } = useGetTeamsListQuery();
  
  const { 
    data: teamAData, 
    isLoading: isLoadingTeamA,
    isFetching: isFetchingTeamA,
    error: teamAError 
  } = useGetTeamPlayersQuery(teamA, { skip: !teamA });
  
  const { 
    data: teamBData, 
    isLoading: isLoadingTeamB,
    isFetching: isFetchingTeamB,
    error: teamBError 
  } = useGetTeamPlayersQuery(teamB, { skip: !teamB });

  return {
    teams,
    isLoadingTeams,
    teamsError,
    teamAData,
    isLoadingTeamA: isFetchingTeamA,
    teamAError,
    teamBData,
    isLoadingTeamB: isFetchingTeamB,
    teamBError,
  };
};