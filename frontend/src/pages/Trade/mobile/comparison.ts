import type { Player, Team } from '../../../types/api';
import type { TradeMode } from '../../../hooks/useTradeState';
import {
  aggregatePlayerAverages,
  aggregatePlayerStats,
  aggregateExtraAverages,
  aggregateExtraTotals,
  extraCountingCategories,
} from '../utils/tradeCalculations';
import { averageZ, type PlayerValueLookup } from '../utils/playerValues';
import type { ViewMode } from './format';

export interface SideRow {
  id: 'A' | 'B';
  label: string;
  players: Player[];
  fixed: Record<string, number>;
  extras: Record<string, number>;
  z: number | null;
}

export interface TradeComparisonProps {
  teamA: Team | null;
  teamB: Team | null;
  playersA: Player[];
  playersB: Player[];
  viewMode: ViewMode;
  tradeMode: TradeMode;
  periodLabel: string;
  playerValue?: PlayerValueLookup;
}

/** Labels of the two comparison rows, as in the design: what each side ends up with. */
export function sideLabels(tradeMode: TradeMode, teamA: Team | null, teamB: Team | null): [string, string] {
  if (tradeMode === 'freeAgent') return ['Drop', 'Add'];
  return [`${teamA?.team_name ?? 'Team A'} gets`, `${teamB?.team_name ?? 'Team B'} gets`];
}


/**
 * Trade Comparison on a phone: one row per side, the side label pinned, Avg Z
 * then the stat columns, green/red against the other side as on desktop.
 * Rows read as what each side receives (the share card's framing): in a team
 * trade, team A's row holds the players team B sends. Show/Hide Columns and
 * "8 cats only" work as on desktop; the phone opens on the categories.
 */
export function buildTradeComparison({ teamA, teamB, playersA, playersB, viewMode, tradeMode, playerValue }: TradeComparisonProps) {
  const isTeamTrade = tradeMode === 'team';
  const [labelA, labelB] = sideLabels(tradeMode, teamA, teamB);
  // Team trade: A gets B's players. Free agents: Drop = your players, Add = free agents.
  const getsA = isTeamTrade ? playersB : playersA;
  const getsB = isTeamTrade ? playersA : playersB;
  const extraCategories = extraCountingCategories([...playersA, ...playersB]);
  const agg = viewMode === 'averages' ? aggregatePlayerAverages : aggregatePlayerStats;
  const aggExtras = viewMode === 'averages' ? aggregateExtraAverages : aggregateExtraTotals;
  const build = (id: 'A' | 'B', label: string, players: Player[]): SideRow => ({
    id, label, players,
    fixed: agg(players) as unknown as Record<string, number>,
    extras: aggExtras(players, extraCategories),
    z: averageZ(players, playerValue),
  });
  const rows = [build('A', labelA, getsA), build('B', labelB, getsB)];
  return { rows, extraCategories, ready: playersA.length > 0 && playersB.length > 0, showZ: playerValue !== undefined };
}

