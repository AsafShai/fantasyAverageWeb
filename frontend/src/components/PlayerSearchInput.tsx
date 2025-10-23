import React, { useState, useRef, useEffect } from 'react';
import type { Player } from '../types/api';
import { useDebounce } from '../hooks/useDebounce';

interface PlayerSearchInputProps {
  players: Player[];
  onPlayerSelect: (player: Player) => void;
  selectedPlayers: Player[];
  viewMode: 'totals' | 'averages';
  placeholder?: string;
}

export const PlayerSearchInput: React.FC<PlayerSearchInputProps> = ({
  players,
  onPlayerSelect,
  selectedPlayers,
  viewMode,
  placeholder = 'Search players...',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const debouncedSearch = useDebounce(searchTerm, 300);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const availablePlayers = players.filter(
    player => !selectedPlayers.some(selected => selected.player_name === player.player_name)
  );

  const filteredPlayers = React.useMemo(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) return [];

    const search = debouncedSearch.toLowerCase();
    return availablePlayers
      .filter(p =>
        p.player_name.toLowerCase().includes(search) ||
        p.pro_team.toLowerCase().includes(search) ||
        p.positions.some(pos => pos.toLowerCase().includes(search))
      )
      .slice(0, 20);
  }, [debouncedSearch, availablePlayers]);

  const formatStat = (value: number, gp: number) => {
    if (viewMode === 'averages') {
      return gp > 0 ? (value / gp).toFixed(1) : '0.0';
    }
    return value.toFixed(1);
  };

  const handleSelectPlayer = (player: Player) => {
    onPlayerSelect(player);
    setSearchTerm('');
    setIsOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
  };

  const handleInputFocus = () => {
    if (searchTerm.length >= 2) {
      setIsOpen(true);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          className="w-full p-2 pl-9 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-sm"
        />
        <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
          🔍
        </div>
      </div>

      {isOpen && filteredPlayers.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {filteredPlayers.map((player) => (
            <div
              key={player.player_name}
              className="p-3 hover:bg-blue-50 cursor-pointer border-b border-gray-100 last:border-b-0"
              onClick={() => handleSelectPlayer(player)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium text-gray-900 text-sm">
                    {player.player_name}
                    <span className="ml-2 text-xs text-gray-500">
                      ({player.positions.join('/')})
                    </span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {player.pro_team} • {formatStat(player.stats.pts, player.stats.gp)} PPG, {formatStat(player.stats.reb, player.stats.gp)} RPG, {formatStat(player.stats.ast, player.stats.gp)} APG
                  </div>
                </div>
                <button
                  className="ml-2 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectPlayer(player);
                  }}
                >
                  + Add
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isOpen && debouncedSearch.length >= 2 && filteredPlayers.length === 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-4 text-center text-gray-500 text-sm">
          No players found matching "{debouncedSearch}"
        </div>
      )}

      {searchTerm.length > 0 && searchTerm.length < 2 && (
        <div className="mt-1 text-xs text-gray-500">
          Type at least 2 characters to search
        </div>
      )}
    </div>
  );
};
