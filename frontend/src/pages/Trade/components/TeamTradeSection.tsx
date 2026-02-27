import React from 'react';
import type { Player, Team } from '../../../types/api';
import { PlayerStatsCard } from './PlayerStatsCard';
import { PlayerDropdown } from './PlayerDropdown';
import { TeamRankingsBar } from './TeamRankingsBar';
import LoadingSpinner from '../../../components/LoadingSpinner';
import ErrorMessage from '../../../components/ErrorMessage';

interface TeamTradeSectionProps {
  title: string;
  teams: Team[];
  selectedTeam: Team | null;
  onTeamChange: (team: Team | null) => void;
  players: Player[];
  selectedPlayers: Player[];
  onPlayerSelect: (player: Player) => void;
  onPlayerRemove: (player: Player) => void;
  isLoadingTeams: boolean;
  isLoadingPlayers: boolean;
  teamsError: unknown;
  playersError: unknown;
  viewMode: 'totals' | 'averages';
  categoryRanks?: Record<string, number>;
}

export const TeamTradeSection: React.FC<TeamTradeSectionProps> = ({
  title,
  teams,
  selectedTeam,
  onTeamChange,
  players,
  selectedPlayers,
  onPlayerSelect,
  onPlayerRemove,
  isLoadingTeams,
  isLoadingPlayers,
  teamsError,
  playersError,
  viewMode,
  categoryRanks,
}) => {


  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {selectedTeam && (
          <div className="text-sm text-gray-500">
            {players.length} players available
          </div>
        )}
      </div>
      
      {/* Team Selection */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Select Team
        </label>
        {isLoadingTeams ? (
          <LoadingSpinner />
        ) : teamsError ? (
          <ErrorMessage message="Failed to load teams" />
        ) : (
          <select
            value={selectedTeam?.team_id ?? ''}
            onChange={(e) => onTeamChange(teams.find(team => team.team_id === parseInt(e.target.value)) || null)}
            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
          >
            <option value="">Choose a team...</option>
            {teams.map((team) => (
              <option key={team.team_id} value={team.team_id}>
                {team.team_name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Team Rankings Bar */}
      {selectedTeam && categoryRanks && (
        <div>
          <h3 className="text-xs font-medium text-gray-700 mb-1">
            Team Category Rankings
          </h3>
          <TeamRankingsBar categoryRanks={categoryRanks} />
        </div>
      )}

      {/* Available Players */}
      {selectedTeam && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            Add Players
          </h3>
          {isLoadingPlayers ? (
            <LoadingSpinner />
          ) : playersError ? (
            <ErrorMessage message="Failed to load players" />
          ) : (
            <PlayerDropdown
              players={players}
              selectedPlayers={selectedPlayers}
              onPlayerSelect={onPlayerSelect}
              viewMode={viewMode}
            />
          )}
        </div>
      )}

      {/* Selected Players */}
      {selectedPlayers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            Selected Players ({selectedPlayers.length})
          </h3>
          <div className="space-y-2">
            {selectedPlayers.map((player) => (
              <PlayerStatsCard
                key={player.player_name}
                player={player}
                isSelected={true}
                onSelect={() => {}}
                onRemove={() => onPlayerRemove(player)}
                showStats={true}
                viewMode={viewMode}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!selectedTeam && (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-4">🏀</div>
          <p className="text-lg font-medium">Select a team to view available players</p>
        </div>
      )}
    </div>
  );
};