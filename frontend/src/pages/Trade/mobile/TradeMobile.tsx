import { useEffect } from 'react';
import type { CustomDateRange, Player, Team, TimePeriod } from '../../../types/api';
import type { TradeMode } from '../../../hooks/useTradeState';
import { enumParam, useUrlState, type UrlSchema } from '../../../hooks/useUrlState';
import { ensureMobileFonts } from '../../../mobile/fonts';
import { Segmented } from '../../../mobile/ui';
import type { PlayerValueLookup, TradeRankingContext } from '../utils/playerValues';
import { PeriodChips } from './PeriodChips';
import { FreeAgentSideCard, TeamSideCard } from './TradeSideCard';
import { TradeComparisonCard } from './TradeComparisonCard';
import type { ViewMode } from './format';
import './trade-mobile.css';

type Side = 'A' | 'B';
const SIDE_SCHEMA: UrlSchema<{ side: Side }> = { side: enumParam<Side>(['A', 'B'], 'A') };

export interface TradeMobileProps {
  tradeMode: TradeMode;
  setTradeMode: (mode: TradeMode) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  timePeriod: TimePeriod;
  setTimePeriod: (period: TimePeriod) => void;
  customRange: CustomDateRange | null;
  setCustomRange: (range: CustomDateRange | null) => void;
  periodLabel: string;
  teams: Team[];
  isLoadingTeams: boolean;
  teamsError: unknown;
  teamA: Team | null;
  teamB: Team | null;
  onTeamAChange: (team: Team | null) => void;
  onTeamBChange: (team: Team | null) => void;
  teamAPlayers: Player[];
  teamBPlayers: Player[];
  teamARanks?: Record<string, number>;
  teamBRanks?: Record<string, number>;
  isFetchingTeamA: boolean;
  isFetchingTeamB: boolean;
  teamAError: unknown;
  teamBError: unknown;
  selectedA: Player[];
  selectedB: Player[];
  selectedFreeAgents: Player[];
  onPlayerASelect: (p: Player) => void;
  onPlayerARemove: (p: Player) => void;
  onPlayerBSelect: (p: Player) => void;
  onPlayerBRemove: (p: Player) => void;
  onFreeAgentSelect: (p: Player) => void;
  onFreeAgentRemove: (p: Player) => void;
  freeAgents: Player[];
  isFetchingFreeAgents: boolean;
  freeAgentsError: unknown;
  playerValue?: PlayerValueLookup;
  tradeRanking?: TradeRankingContext;
}

/**
 * Trade Analyzer on a phone (mobile redesign, step 4). Same controls and data
 * as desktop; the two side columns become one card at a time behind a
 * Team A / Team B switch (kept in the URL as ?side=B), followed by the
 * comparison and a sticky Avg Z summary.
 */
export function TradeMobile(props: TradeMobileProps) {
  const { tradeMode, viewMode, playerValue, tradeRanking } = props;
  const [{ side }, setUrl] = useUrlState(SIDE_SCHEMA);
  useEffect(() => { ensureMobileFonts(); }, []);

  const isTeam = tradeMode === 'team';
  const comparison = {
    teamA: props.teamA,
    teamB: isTeam ? props.teamB : null,
    playersA: props.selectedA,
    playersB: isTeam ? props.selectedB : props.selectedFreeAgents,
    viewMode,
    tradeMode,
    periodLabel: props.periodLabel,
    playerValue,
    tradeRanking,
  };
  const countA = props.selectedA.length;
  const countB = isTeam ? props.selectedB.length : props.selectedFreeAgents.length;
  const withCount = (label: string, n: number) => (n > 0 ? `${label} (${n})` : label);

  return (
    <div className="mr-root mr-trade">
      <div className="mr-trade-title">
        <h1 className="mr-h1">🔄 Trade Analyzer</h1>
        <p className="mr-meta">
          {isTeam
            ? 'Select players from two teams to analyze potential trades with comprehensive statistical breakdowns'
            : 'Compare your team players against free agents and waivers to find the best pickups'}
        </p>
      </div>

      <Segmented
        label="Trade mode"
        value={tradeMode}
        onChange={props.setTradeMode}
        options={[{ value: 'team', label: '🔄 Team vs Team' }, { value: 'freeAgent', label: '🆓 Team vs Free Agents' }]}
      />
      <PeriodChips
        value={props.timePeriod}
        onChange={props.setTimePeriod}
        customRange={props.customRange}
        onCustomRangeChange={props.setCustomRange}
      />
      <Segmented
        label="Side"
        value={side}
        onChange={(s) => setUrl({ side: s })}
        options={[
          { value: 'A', label: withCount(isTeam ? 'Team A' : 'Your Team', countA) },
          { value: 'B', label: withCount(isTeam ? 'Team B' : 'Free Agents', countB) },
        ]}
      />

      {side === 'A' ? (
        <TeamSideCard
          sideId="A"
          title={isTeam ? 'Team A' : 'Your Team'}
          teams={props.teams}
          selectedTeam={props.teamA}
          onTeamChange={props.onTeamAChange}
          players={props.teamAPlayers}
          selectedPlayers={props.selectedA}
          onPlayerSelect={props.onPlayerASelect}
          onPlayerRemove={props.onPlayerARemove}
          isLoadingTeams={props.isLoadingTeams}
          isLoadingPlayers={props.isFetchingTeamA}
          teamsError={props.teamsError}
          playersError={props.teamAError}
          viewMode={viewMode}
          playerValue={playerValue}
          categoryRanks={props.teamARanks}
        />
      ) : isTeam ? (
        <TeamSideCard
          sideId="B"
          title="Team B"
          teams={props.teams}
          selectedTeam={props.teamB}
          onTeamChange={props.onTeamBChange}
          players={props.teamBPlayers}
          selectedPlayers={props.selectedB}
          onPlayerSelect={props.onPlayerBSelect}
          onPlayerRemove={props.onPlayerBRemove}
          isLoadingTeams={props.isLoadingTeams}
          isLoadingPlayers={props.isFetchingTeamB}
          teamsError={props.teamsError}
          playersError={props.teamBError}
          viewMode={viewMode}
          playerValue={playerValue}
          categoryRanks={props.teamBRanks}
        />
      ) : (
        <FreeAgentSideCard
          players={props.freeAgents}
          selectedPlayers={props.selectedFreeAgents}
          onPlayerSelect={props.onFreeAgentSelect}
          onPlayerRemove={props.onFreeAgentRemove}
          isLoading={props.isFetchingFreeAgents}
          error={props.freeAgentsError}
          viewMode={viewMode}
          playerValue={playerValue}
        />
      )}

      <TradeComparisonCard {...comparison} setViewMode={props.setViewMode} />
    </div>
  );
}
