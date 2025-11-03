import React from 'react';
import { TeamTradeSection } from './components/TeamTradeSection';
import { TradeStatsToggle } from './components/TradeStatsToggle';
import { TradeModeToggle } from './components/TradeModeToggle';
import { FreeAgentSection } from './components/FreeAgentSection';
import { TradeSummaryPanel } from './components/TradeSummaryPanel';
import { useTradeState } from '../../hooks/useTradeState';
import { useTradeData } from '../../hooks/useTradeData';

export const Trade: React.FC = () => {
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
  } = useTradeData(teamA, teamB, tradeMode);

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

      {/* Stats Toggle */}
      <TradeStatsToggle viewMode={viewMode} onToggle={setViewMode} />

      {/* Trade Sections */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {/* Team A Section */}
        <TeamTradeSection
          title={tradeMode === 'team' ? 'Team A' : 'Your Team'}
          teams={teams}
          selectedTeam={teamA}
          onTeamChange={handleTeamAChange}
          players={teamAData?.players || []}
          selectedPlayers={selectedPlayersA}
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
            selectedPlayers={selectedPlayersB}
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
            selectedPlayers={selectedFreeAgents}
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
          playersA={selectedPlayersA}
          playersB={tradeMode === 'team' ? selectedPlayersB : selectedFreeAgents}
          viewMode={viewMode}
          tradeMode={tradeMode}
        />
      </div>
    </div>
  );
};

export default Trade;