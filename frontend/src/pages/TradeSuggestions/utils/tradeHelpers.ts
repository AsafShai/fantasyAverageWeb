import type { Player, Team } from '../../../types/api';

export interface PlayerGroup {
  team: Team;
  players: Player[];
}

export const groupPlayersByTeam = (
  playersToGive: Player[], 
  playersToReceive: Player[], 
  userTeam: Team, 
  opponentTeam: Team
): { givingGroup: PlayerGroup; receivingGroup: PlayerGroup } => {
  return {
    givingGroup: {
      team: userTeam,
      players: playersToGive || []
    },
    receivingGroup: {
      team: opponentTeam,
      players: playersToReceive || []
    }
  };
};

export const formatStatValue = (
  value: number,
  gamesPlayed: number,
  viewMode: 'totals' | 'averages',
  isPercentage: boolean = false,
  isGamesPlayed: boolean = false
): string => {
  if (isGamesPlayed) {
    return Math.round(value).toString();
  }

  if (isPercentage) {
    return `${value.toFixed(4)}%`;
  }

  if (viewMode === 'averages' && gamesPlayed > 0) {
    return (value / gamesPlayed).toFixed(4);
  }

  return Math.round(value).toString();
};

export const getComparisonColor = (difference: number): string => {
  if (Math.abs(difference) < 0.5) return 'text-gray-600';
  return difference > 0 ? 'text-green-600' : 'text-red-600';
};

export const getComparisonIcon = (difference: number): string => {
  if (Math.abs(difference) < 0.5) return '→';
  return difference > 0 ? '↗️' : '↘️';
};