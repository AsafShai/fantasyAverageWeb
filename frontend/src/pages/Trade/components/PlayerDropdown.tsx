import React, { useState } from 'react';
import type { Player } from '../../../types/api';
import { formatStatValue } from '../utils/tradeCalculations';

interface PlayerDropdownProps {
  players: Player[];
  selectedPlayers: Player[];
  onPlayerSelect: (player: Player) => void;
  viewMode: 'totals' | 'averages';
}

export const PlayerDropdown: React.FC<PlayerDropdownProps> = ({
  players,
  selectedPlayers,
  onPlayerSelect,
  viewMode,
}) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState('');

  const availablePlayers = players.filter(
    player => !selectedPlayers.some(selected => selected.player_name === player.player_name)
  );

  const handleAddPlayer = () => {
    if (selectedPlayerId) {
      const player = players.find(p => p.player_name === selectedPlayerId);
      if (player) {
        onPlayerSelect(player);
        setSelectedPlayerId('');
      }
    }
  };

  const formatPlayerOption = (player: Player) => {
    const displayStats = viewMode === 'averages' 
      ? player.stats.gp > 0 ? {
          pts: player.stats.pts / player.stats.gp,
          reb: player.stats.reb / player.stats.gp,
          ast: player.stats.ast / player.stats.gp
        } : {
          pts: 0,
          reb: 0,
          ast: 0
        }
      : player.stats;

    return `${player.player_name} (${player.positions.join('/')}) - ${formatStatValue(displayStats.pts, false, viewMode)} PTS, ${formatStatValue(displayStats.reb, false, viewMode)} REB, ${formatStatValue(displayStats.ast, false, viewMode)} AST`;
  };

  if (availablePlayers.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        All players have been selected
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select
        value={selectedPlayerId}
        onChange={(e) => setSelectedPlayerId(e.target.value)}
        className="flex-1 p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
      >
        <option value="">Select a player to add...</option>
        {availablePlayers.map((player) => (
          <option key={player.player_name} value={player.player_name}>
            {formatPlayerOption(player)}
          </option>
        ))}
      </select>
      <button
        onClick={handleAddPlayer}
        disabled={!selectedPlayerId}
        className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium transition-colors"
      >
        Add
      </button>
    </div>
  );
};