import { useState, useCallback } from 'react';
import type { Player, Team } from '../types/api';

export type TradeMode = 'team' | 'freeAgent';

interface UseTradeStateReturn {
  teamA: Team | null;
  teamB: Team | null;
  selectedPlayersA: Player[];
  selectedPlayersB: Player[];
  selectedFreeAgents: Player[];
  viewMode: 'totals' | 'averages';
  tradeMode: TradeMode;
  setViewMode: (mode: 'totals' | 'averages') => void;
  setTradeMode: (mode: TradeMode) => void;

  handleTeamAChange: (team: Team | null) => void;
  handlePlayerASelect: (player: Player) => void;
  handlePlayerARemove: (player: Player) => void;

  handleTeamBChange: (team: Team | null) => void;
  handlePlayerBSelect: (player: Player) => void;
  handlePlayerBRemove: (player: Player) => void;

  handleFreeAgentSelect: (player: Player) => void;
  handleFreeAgentRemove: (player: Player) => void;
}

export const useTradeState = (): UseTradeStateReturn => {
  const [teamA, setTeamA] = useState<Team | null>(null);
  const [teamB, setTeamB] = useState<Team | null>(null);
  const [selectedPlayersA, setSelectedPlayersA] = useState<Player[]>([]);
  const [selectedPlayersB, setSelectedPlayersB] = useState<Player[]>([]);
  const [selectedFreeAgents, setSelectedFreeAgents] = useState<Player[]>([]);
  const [viewMode, setViewMode] = useState<'totals' | 'averages'>('averages');
  const [tradeMode, setTradeMode] = useState<TradeMode>('team');

  const handleTeamAChange = useCallback((team: Team | null) => {
    setTeamA(team);
    setSelectedPlayersA([]);
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

  const handleTeamBChange = useCallback((team: Team | null) => {
    setTeamB(team);
    setSelectedPlayersB([]);
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

  const handleFreeAgentSelect = useCallback((player: Player) => {
    setSelectedFreeAgents(prev => {
      if (!prev.some(p => p.player_name === player.player_name)) {
        return [...prev, player];
      }
      return prev;
    });
  }, []);

  const handleFreeAgentRemove = useCallback((player: Player) => {
    setSelectedFreeAgents(prev => prev.filter(p => p.player_name !== player.player_name));
  }, []);

  const handleTradeModeChange = useCallback((mode: TradeMode) => {
    setTradeMode(mode);
    setTeamB(null);
    setSelectedPlayersB([]);
    setSelectedFreeAgents([]);
  }, []);

  return {
    teamA,
    teamB,
    selectedPlayersA,
    selectedPlayersB,
    selectedFreeAgents,
    viewMode,
    tradeMode,
    setViewMode,
    setTradeMode: handleTradeModeChange,
    handleTeamAChange,
    handlePlayerASelect,
    handlePlayerARemove,
    handleTeamBChange,
    handlePlayerBSelect,
    handlePlayerBRemove,
    handleFreeAgentSelect,
    handleFreeAgentRemove,
  };
};