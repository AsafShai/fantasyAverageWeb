import React, { useState, useMemo, useEffect } from 'react';
import type { TimePeriod, CustomDateRange } from '../../types/api';
import { TeamTradeSection } from './components/TeamTradeSection';
import { TradeStatsToggle } from './components/TradeStatsToggle';
import { TradeModeToggle } from './components/TradeModeToggle';
import { FreeAgentSection } from './components/FreeAgentSection';
import { TradeSummaryPanel } from './components/TradeSummaryPanel';
import { useTradeState } from '../../hooks/useTradeState';
import { useTradeData } from '../../hooks/useTradeData';
import TimePeriodSelector from '../../components/TimePeriodSelector';

export const Trade: React.FC = () => {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('season');
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);

  const {
    teamA,
    teamB,
    selectedPlayersA,
    selectedPlayersB,
    selectedFreeAgents,
    viewMode,
    tradeMode,
    setViewMode,
    setTradeMode,
    handleTeamAChange,
    handlePlayerASelect,
    handlePlayerARemove,
    handleTeamBChange,
    handlePlayerBSelect,
    handlePlayerBRemove,
    handleFreeAgentSelect,
    handleFreeAgentRemove,
  } = useTradeState();

  const {
    teams,
    isLoadingTeams,
    teamsError,
    teamAData,
    isFetchingTeamA,
    teamAError,
    teamBData,
    isFetchingTeamB,
    teamBError,
    freeAgents,
    isFetchingFreeAgents,
    freeAgentsError,
  } = useTradeData(teamA, teamB, tradeMode, timePeriod, customRange);

  // Derive selected players from the latest fetched data so stats update
  // immediately when the time period changes, without needing to re-select.
  // teamAData/teamBData/freeAgents already exclude has_data:false players, so a
  // selected player with no data for the active custom range simply drops out
  // here rather than lingering with stale stats.
  const currentSelectedPlayersA = useMemo(() => {
    if (!teamAData?.players || selectedPlayersA.length === 0) return [];
    return selectedPlayersA
      .map(selected => teamAData.players!.find(p => p.player_name === selected.player_name))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  }, [selectedPlayersA, teamAData]);

  const currentSelectedPlayersB = useMemo(() => {
    if (!teamBData?.players || selectedPlayersB.length === 0) return [];
    return selectedPlayersB
      .map(selected => teamBData.players!.find(p => p.player_name === selected.player_name))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  }, [selectedPlayersB, teamBData]);

  const currentSelectedFreeAgents = useMemo(() => {
    if (!freeAgents.length || selectedFreeAgents.length === 0) return [];
    return selectedFreeAgents
      .map(selected => freeAgents.find(p => p.player_name === selected.player_name))
      .filter((p): p is NonNullable<typeof p> => p !== undefined);
  }, [selectedFreeAgents, freeAgents]);

  useEffect(() => {
    if (timePeriod !== 'custom' || !customRange) return
    const excludedA = teamA && teamAData?.players ? selectedPlayersA.filter(p => !teamAData.players!.some(tp => tp.player_name === p.player_name)) : []
    const excludedB = teamB && teamBData?.players ? selectedPlayersB.filter(p => !teamBData.players!.some(tp => tp.player_name === p.player_name)) : []
    const excludedFA = selectedFreeAgents.filter(p => !freeAgents.some(fp => fp.player_name === p.player_name))
    const allExcluded = [...excludedA, ...excludedB, ...excludedFA]
    if (allExcluded.length > 0) {
      console.warn(
        `${allExcluded.length} selected players excluded from trade valuation (no data for ${customRange.start}–${customRange.end}):`,
        allExcluded.map(p => p.player_name)
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timePeriod, customRange, teamAData, teamBData, freeAgents])

  return (
    <div className="max-w-none mx-auto px-4 py-3">
      {/* Header */}
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
          🔄 Trade Analyzer
        </h1>
        <p className="text-sm text-gray-600 max-w-2xl mx-auto">
          {tradeMode === 'team'
            ? 'Select players from two teams to analyze potential trades with comprehensive statistical breakdowns'
            : 'Compare your team players against free agents and waivers to find the best pickups'}
        </p>
      </div>

      {/* Mode Toggle */}
      <TradeModeToggle mode={tradeMode} onToggle={setTradeMode} />

      {/* Time Period & Stats Toggles */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap justify-center items-start gap-4 mb-4">
        <TimePeriodSelector value={timePeriod} onChange={setTimePeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
        <TradeStatsToggle viewMode={viewMode} onToggle={setViewMode} />
      </div>

      {/* Trade Sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {/* Team A Section */}
        <TeamTradeSection
          title={tradeMode === 'team' ? 'Team A' : 'Your Team'}
          teams={teams}
          selectedTeam={teamA}
          onTeamChange={handleTeamAChange}
          players={teamAData?.players || []}
          selectedPlayers={currentSelectedPlayersA}
          onPlayerSelect={handlePlayerASelect}
          onPlayerRemove={handlePlayerARemove}
          isLoadingTeams={isLoadingTeams}
          isLoadingPlayers={isFetchingTeamA}
          teamsError={teamsError}
          playersError={teamAError}
          viewMode={viewMode}
          categoryRanks={teamAData?.category_ranks}
        />

        {/* Team B Section or Free Agent Section */}
        {tradeMode === 'team' ? (
          <TeamTradeSection
            title="Team B"
            teams={teams}
            selectedTeam={teamB}
            onTeamChange={handleTeamBChange}
            players={teamBData?.players || []}
            selectedPlayers={currentSelectedPlayersB}
            onPlayerSelect={handlePlayerBSelect}
            onPlayerRemove={handlePlayerBRemove}
            isLoadingTeams={isLoadingTeams}
            isLoadingPlayers={isFetchingTeamB}
            teamsError={teamsError}
            playersError={teamBError}
            viewMode={viewMode}
            categoryRanks={teamBData?.category_ranks}
          />
        ) : (
          <FreeAgentSection
            players={freeAgents}
            selectedPlayers={currentSelectedFreeAgents}
            onPlayerSelect={handleFreeAgentSelect}
            onPlayerRemove={handleFreeAgentRemove}
            isLoading={isFetchingFreeAgents}
            error={freeAgentsError}
            viewMode={viewMode}
          />
        )}
      </div>

      {/* Trade Summary Panel */}
      <div className="card p-3">
        <TradeSummaryPanel
          teamA={teamA}
          teamB={tradeMode === 'team' ? teamB : null}
          playersA={currentSelectedPlayersA}
          playersB={tradeMode === 'team' ? currentSelectedPlayersB : currentSelectedFreeAgents}
          viewMode={viewMode}
          tradeMode={tradeMode}
        />
      </div>
    </div>
  );
};

export default Trade;