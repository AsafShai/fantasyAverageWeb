import React from 'react';
import type { Player } from '../../../types/api';
import { PlayerStatsCard } from './PlayerStatsCard';
import { PlayerSearchInput } from '../../../components/PlayerSearchInput';
import LoadingSpinner from '../../../components/LoadingSpinner';
import ErrorMessage from '../../../components/ErrorMessage';

interface FreeAgentSectionProps {
  players: Player[];
  selectedPlayers: Player[];
  onPlayerSelect: (player: Player) => void;
  onPlayerRemove: (player: Player) => void;
  isLoading: boolean;
  error: unknown;
  viewMode: 'totals' | 'averages';
}

export const FreeAgentSection: React.FC<FreeAgentSectionProps> = ({
  players,
  selectedPlayers,
  onPlayerSelect,
  onPlayerRemove,
  isLoading,
  error,
  viewMode,
}) => {
  const freeAgentCount = players.length;

  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-gray-900">Free Agent Pool</h2>
        {!isLoading && !error && (
          <div className="text-sm text-gray-500">
            {freeAgentCount} free agents available
          </div>
        )}
      </div>

      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-700 mb-1">
          Search Free Agents & Waivers
        </label>
        {isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorMessage message="Failed to load free agents" />
        ) : (
          <PlayerSearchInput
            players={players}
            onPlayerSelect={onPlayerSelect}
            selectedPlayers={selectedPlayers}
            viewMode={viewMode}
            placeholder="Type player name, team, or position..."
          />
        )}
      </div>

      {selectedPlayers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-800 mb-2">
            Selected Free Agents ({selectedPlayers.length})
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

      {!isLoading && !error && selectedPlayers.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <div className="text-4xl mb-4">🔍</div>
          <p className="text-lg font-medium">Search for free agents</p>
          <p className="text-sm mt-1">Type at least 2 characters to see results</p>
        </div>
      )}
    </div>
  );
};
