import { useState, useCallback } from 'react';
import type { Player } from '../types/api';

interface UseTradeStateReturn {
  teamA: string;
  teamB: string;
  selectedPlayersA: Player[];
  selectedPlayersB: Player[];
  viewMode: 'totals' | 'averages';
  setViewMode: (mode: 'totals' | 'averages') => void;
  
  // Team A handlers
  handleTeamAChange: (team: string) => void;
  handlePlayerASelect: (player: Player) => void;
  handlePlayerARemove: (player: Player) => void;
  
  // Team B handlers
  handleTeamBChange: (team: string) => void;
  handlePlayerBSelect: (player: Player) => void;
  handlePlayerBRemove: (player: Player) => void;
}

export const useTradeState = (): UseTradeStateReturn => {
  const [teamA, setTeamA] = useState('');
  const [teamB, setTeamB] = useState('');
  const [selectedPlayersA, setSelectedPlayersA] = useState<Player[]>([]);
  const [selectedPlayersB, setSelectedPlayersB] = useState<Player[]>([]);
  const [viewMode, setViewMode] = useState<'totals' | 'averages'>('totals');

  // Team A handlers
  const handleTeamAChange = useCallback((team: string) => {
    setTeamA(team);
    setSelectedPlayersA([]); // Clear selections when changing team
  }, []);

  const handlePlayerASelect = useCallback((player: Player) => {
    setSelectedPlayersA(prev => {
      if (!prev.some(p => p.player_name === player.player_name)) {
        return [...prev, player];
      }
      return prev;
    });
  }, []);

  const handlePlayerARemove = useCallback((player: Player) => {
    setSelectedPlayersA(prev => prev.filter(p => p.player_name !== player.player_name));
  }, []);

  // Team B handlers
  const handleTeamBChange = useCallback((team: string) => {
    setTeamB(team);
    setSelectedPlayersB([]); // Clear selections when changing team
  }, []);

  const handlePlayerBSelect = useCallback((player: Player) => {
    setSelectedPlayersB(prev => {
      if (!prev.some(p => p.player_name === player.player_name)) {
        return [...prev, player];
      }
      return prev;
    });
  }, []);

  const handlePlayerBRemove = useCallback((player: Player) => {
    setSelectedPlayersB(prev => prev.filter(p => p.player_name !== player.player_name));
  }, []);

  return {
    teamA,
    teamB,
    selectedPlayersA,
    selectedPlayersB,
    viewMode,
    setViewMode,
    handleTeamAChange,
    handlePlayerASelect,
    handlePlayerARemove,
    handleTeamBChange,
    handlePlayerBSelect,
    handlePlayerBRemove,
  };
};