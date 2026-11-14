import React, { useState } from 'react';
import type { Player, Team } from '../../../types/api';
import type { TradeMode } from '../../../hooks/useTradeState';
import {
  aggregatePlayerStats,
  aggregatePlayerAverages,
  extraCountingCategories,
} from '../utils/tradeCalculations';
import { useMyTeam } from '../../../context/MyTeamContext';
import { useIsDarkTheme } from '../../../hooks/useIsDarkTheme';
import { ShareCardButton } from '../../../components/share/ShareCardButton';
import { TradeShareCard, type TradeShareSide } from '../../../components/share/TradeShareCard';
import { formatAsOf } from '../../../components/share/shareCardFormat';
import type { PlayerValueLookup, TradeRankingContext } from '../utils/playerValues';
import { tradeShareRows } from '../utils/tradeShare';
import { CATEGORY_Z_NOTE, EVEN_Z_GAP } from '../utils/tradeCategoryZ';
import type { AggregatedStats } from '../utils/tradeCalculations';
import {
  categoryOnlyColumns,
  columnFromKey,
  type DisplayColumn,
} from './tradeComparisonColumns';
import { TradeVersusComparison } from './TradeVersusComparison';
import '../trade-comparison.css';

interface TradeSummaryPanelProps {
  teamA: Team | null;
  teamB: Team | null;
  playersA: Player[];
  playersB: Player[];
  viewMode: 'totals' | 'averages';
  tradeMode: TradeMode;
  /** Time window of the stats, e.g. "Season" or "Last 30 days"; shown on the share card. */
  periodLabel?: string;
  /** Rank and z-score of each player, shown on the share card and averaged per side in the table. */
  playerValue?: PlayerValueLookup;
  tradeRanking?: TradeRankingContext;
  /** When set, totals / per-game pills render in the comparison toolbar. */
  onViewModeChange?: (mode: 'totals' | 'averages') => void;
}

const NeutralStat: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="tc-detail-stat">{children}</span>
);

const TradeDetailGrid: React.FC<{
  neutralColumns: DisplayColumn[];
  teamAName: string;
  teamBName: string;
  rowA: React.ReactNode[];
  rowB: React.ReactNode[];
}> = ({ neutralColumns, teamAName, teamBName, rowA, rowB }) => (
  <div className="tc-detail-grid">
    <div
      className="tc-detail-grid__grid"
      style={{ gridTemplateColumns: `minmax(6.5rem, 1.15fr) repeat(${neutralColumns.length}, minmax(3.25rem, 1fr))` }}
    >
      <div className="tc-detail-grid__head tc-detail-grid__head--left">Team</div>
      {neutralColumns.map(({ key, label, icon }) => (
        <div key={key} className="tc-detail-grid__head">
          <span aria-hidden>{icon}</span>
          <div>{label}</div>
        </div>
      ))}
      <div className="tc-detail-grid__cell tc-detail-grid__team" title={teamAName}>{teamAName}</div>
      {rowA.map((cell, i) => (
        <div key={neutralColumns[i]?.key ?? i} className="tc-detail-grid__cell">{cell}</div>
      ))}
      <div className="tc-detail-grid__cell tc-detail-grid__team" title={teamBName}>{teamBName}</div>
      {rowB.map((cell, i) => (
        <div key={neutralColumns[i]?.key ?? `b-${i}`} className="tc-detail-grid__cell">{cell}</div>
      ))}
    </div>
  </div>
);

export const TradeSummaryPanel: React.FC<TradeSummaryPanelProps> = React.memo(({
  onViewModeChange,
  teamA,
  teamB,
  playersA,
  playersB,
  viewMode,
  tradeMode,
  periodLabel = 'Season',
  playerValue,
  tradeRanking,
}) => {
  const { myTeamId } = useMyTeam();
  const dark = useIsDarkTheme();
  // The comparison is the scoring categories (FG%/FT% with made-attempted).
  // Minutes and games aren't scored; they're one tap away for context.
  const [contextShown, setContextShown] = useState(false);

  // League categories beyond the fixed fields (e.g. TO) get their own rows.
  // None for a league on the standard 8 categories.
  const extraCategories = extraCountingCategories([...playersA, ...playersB]);
  const scoringColumns = categoryOnlyColumns(extraCategories);
  const neutralColumns = contextShown
    ? ['minutes', 'gp'].map(columnFromKey).filter((c): c is DisplayColumn => c != null)
    : [];

  // Nothing to compare until both sides have someone.
  if (playersA.length === 0 || playersB.length === 0) {
    const emptyMessage = tradeMode === 'freeAgent'
      ? 'Select players from your team and free agents to see comparison'
      : 'Select players from both teams to see trade analysis';

    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-4xl mb-4">{tradeMode === 'freeAgent' ? '🔍' : '🔄'}</div>
        <h3 className="text-lg font-medium mb-2">
          {tradeMode === 'freeAgent' ? 'No Comparison Selected' : 'No Trade Selected'}
        </h3>
        <p className="text-sm">{emptyMessage}</p>
      </div>
    );
  }

  const isTeamTrade = tradeMode === 'team';
  const getsA = isTeamTrade ? playersB : playersA;
  const getsB = isTeamTrade ? playersA : playersB;
  const aggDisplay = viewMode === 'averages' ? aggregatePlayerAverages : aggregatePlayerStats;
  const displayGetsA = aggDisplay(getsA);
  const displayGetsB = aggDisplay(getsB);

  // Minutes / games cells: context only, no winner.
  const contextCell = (column: DisplayColumn, fixed: AggregatedStats) => {
    const value = fixed[column.key as keyof AggregatedStats];
    const text = viewMode === 'averages' && column.key === 'minutes' ? value.toFixed(1) : Math.round(value).toString();
    return <NeutralStat key={column.key}><span className="font-bold">{text}</span></NeutralStat>;
  };
  const contextRow = (fixed: AggregatedStats) => neutralColumns.map(column => contextCell(column, fixed));

  // Share card: each column is what that team receives, so team A's column
  // holds the stats of the players team B sends, and vice versa.
  const teamAName = teamA?.team_name ?? 'Your team';
  const teamBName = teamB?.team_name ?? 'Team B';
  const shareRows = isTeamTrade
    ? tradeShareRows(playersB, playersA, viewMode, tradeRanking)
    : tradeShareRows(playersA, playersB, viewMode, tradeRanking);
  const sharePlayers = (players: Player[]) => players.map(p => ({
    name: p.player_name,
    playerId: p.player_id,
    value: playerValue?.(p),
  }));
  const shareSides: [TradeShareSide, TradeShareSide] = isTeamTrade
    ? [
      { heading: `${teamAName} gets`, players: sharePlayers(playersB) },
      { heading: `${teamBName} gets`, players: sharePlayers(playersA) },
    ]
    : [
      { heading: `${teamAName} drops`, players: sharePlayers(playersA) },
      { heading: `${teamAName} adds`, players: sharePlayers(playersB) },
    ];
  const mySide = !isTeamTrade || myTeamId === null ? null
    : teamA?.team_id === myTeamId ? 0 : teamB?.team_id === myTeamId ? 1 : null;
  const shareTitle = isTeamTrade ? `${teamAName} ⇄ ${teamBName}` : `${teamAName} pickup check`;

  const viewModeLabel = viewMode === 'averages' ? 'per game, averaged per player' : 'totals';
  const hasValues = playerValue !== undefined;
  const hasCategoryZ = Boolean(tradeRanking?.referencePool.length);

  return (
    <div className="space-y-6">
      {playersA.length > 0 && playersB.length > 0 && (
        <div className={`tc-shell tc-shell--pro${dark ? '' : ' tc-shell--light'}`}>
          <div className="tc-shell__head">
            <div className="tc-shell__brand">
              <span>🏀 Fantasy League</span>
              <span>Trade Analyzer</span>
            </div>
            <div className="tc-shell__head-row">
              <div className="tc-shell__titles">
                <div className="tc-shell__title">{shareTitle}</div>
                <div className="tc-shell__subtitle">
                  {periodLabel} · {viewModeLabel} · as of {formatAsOf()}
                </div>
              </div>
              <ShareCardButton
                title={isTeamTrade ? 'Trade Analysis' : 'Pickup Check'}
                highlightOption={mySide !== null}
                renderCard={({ dark, highlightMyTeam }) => (
                  <TradeShareCard
                    dark={dark}
                    title={shareTitle}
                    subtitle={`${periodLabel} · ${viewModeLabel} · as of ${formatAsOf()}`}
                    sides={shareSides}
                    rows={shareRows}
                    mode={viewMode}
                    highlightSide={highlightMyTeam ? mySide : null}
                  />
                )}
              />
            </div>
          </div>
          <div className="tc-shell__body">
          <div className="tc-toolbar">
            {onViewModeChange && (
              <div className="tc-toolbar__group" role="group" aria-label="Stat totals or per-game averages">
                <button
                  type="button"
                  className="tc-pill-toggle"
                  aria-pressed={viewMode === 'totals'}
                  onClick={() => onViewModeChange('totals')}
                >
                  Totals
                </button>
                <button
                  type="button"
                  className="tc-pill-toggle"
                  aria-pressed={viewMode === 'averages'}
                  onClick={() => onViewModeChange('averages')}
                >
                  Per game
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setContextShown(shown => !shown)}
              aria-pressed={contextShown}
              aria-label="Show minutes and games played"
              className="tc-pill-toggle"
              title="Show minutes and games played (not scored; for context)"
            >
              MIN &amp; GP
            </button>
          </div>
          {scoringColumns.length > 0 && (
            <TradeVersusComparison
              embedded
              teamA={teamA}
              teamB={teamB}
              playersA={playersA}
              playersB={playersB}
              viewMode={viewMode}
              tradeMode={tradeMode}
              playerValue={playerValue}
              tradeRanking={tradeRanking}
              scoringColumns={scoringColumns}
              compositeShooting
              proLayout
            />
          )}
          {neutralColumns.length > 0 && (
            <TradeDetailGrid
              neutralColumns={neutralColumns}
              teamAName={teamA?.team_name || (tradeMode === 'freeAgent' ? 'Your Team' : 'Team A')}
              teamBName={tradeMode === 'freeAgent' ? 'Free Agents' : (teamB?.team_name || 'Team B')}
              rowA={contextRow(displayGetsA)}
              rowB={contextRow(displayGetsB)}
            />
          )}
          </div>
          <div className="tc-shell__foot">
            {hasCategoryZ && <span>{CATEGORY_Z_NOTE}</span>}
            {hasCategoryZ && <span>Bar = Z gap, toward the better side · within {EVEN_Z_GAP.toFixed(2)} = even</span>}
            {hasValues && <span>#rank · Z = player's rank and Z among all players, per game</span>}
          </div>
        </div>
      )}
    </div>
  );
});