import { useState, useCallback } from 'react';
import type { Player, Team } from '../types/api';

export type TradeMode = 'team' | 'freeAgent';

type PresetPlayer = Pick<Player, 'player_name' | 'player_id'>;

/** Where the analyzer starts: each side's team and the players it gives up.
 * Players are matched against the team's roster by id, then by name. The phone
 * player sheet starts it with one side only, or in free-agent mode with the
 * free agent already picked. */
export interface TradeStart {
  teamA: Team | null;
  teamB: Team | null;
  playersA: PresetPlayer[];
  playersB: PresetPlayer[];
  /** Defaults to 'team'. */
  mode?: TradeMode;
  /** Free-agent mode: free agents already picked (matched by name). */
  freeAgents?: PresetPlayer[];
}

/** A full two-team trade to open the analyzer on ("Preview in Trade Analyzer"). */
export interface TradePreset extends TradeStart {
  teamA: Team;
  teamB: Team;
}

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

export const useTradeState = (preset?: TradeStart | null): UseTradeStateReturn => {
  const [teamA, setTeamA] = useState<Team | null>(preset?.teamA ?? null);
  const [teamB, setTeamB] = useState<Team | null>(preset?.teamB ?? null);
  // Stand-ins until the rosters load; the page resolves them to full players.
  const [selectedPlayersA, setSelectedPlayersA] = useState<Player[]>((preset?.playersA ?? []) as Player[]);
  const [selectedPlayersB, setSelectedPlayersB] = useState<Player[]>((preset?.playersB ?? []) as Player[]);
  const [selectedFreeAgents, setSelectedFreeAgents] = useState<Player[]>((preset?.freeAgents ?? []) as Player[]);
  const [viewMode, setViewMode] = useState<'totals' | 'averages'>('averages');
  const [tradeMode, setTradeMode] = useState<TradeMode>(preset?.mode ?? 'team');

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