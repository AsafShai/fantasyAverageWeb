import React, { useState } from 'react';
import type { Player, Team } from '../../../types/api';
import type { TradeMode } from '../../../hooks/useTradeState';
import {
  aggregatePlayerStats,
  aggregatePlayerAverages,
  aggregateExtraAverages,
  aggregateExtraTotals,
  extraCountingCategories,
  formatStatValue,
  KNOWN_REVERSE_CATEGORIES,
} from '../utils/tradeCalculations';
import { STAT_KEYS } from '../constants';
import { useMyTeam } from '../../../context/MyTeamContext';
import { useIsDarkTheme } from '../../../hooks/useIsDarkTheme';
import { ShareCardButton } from '../../../components/share/ShareCardButton';
import { TradeShareCard, type TradeShareSide } from '../../../components/share/TradeShareCard';
import { formatAsOf } from '../../../components/share/shareCardFormat';
import type { PlayerValueLookup, TradeRankingContext } from '../utils/playerValues';
import { tradeShareRows } from '../utils/tradeShare';
import {
  COMPOSITE_FG,
  COMPOSITE_FT,
  CATEGORY_Z_NOTE,
  EVEN_Z_GAP,
  categoryTone,
  formatBundlePct,
  formatMadeAttempted,
  signedCategoryZ,
  tradeSideCategoryZs,
} from '../utils/tradeCategoryZ';
import type { AggregatedStats } from '../utils/tradeCalculations';
import {
  categoryShortcutKeys,
  columnFromKey,
  isCategoriesOnlyView,
  isNeutralColumn,
  scoringCategoryForColumn,
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

interface StatValueProps {
  value: number;
  comparedTo: number;
  isPercentage?: boolean;
  viewMode: 'totals' | 'averages';
  field: string;
  /** Reverse-scored category (e.g. TO): the lower side is the better one. */
  lowerIsBetter?: boolean;
}

interface Column {
  key: string;
  label: string;
  icon: string;
  /** Set for a league category beyond the fixed stat fields. */
  extraCategory?: string;
}

const EXTRA_COLUMN_PREFIX = 'extra:';

/** Fixed columns hidden by the categories-only view. */
const NON_CATEGORY_KEYS = new Set(['minutes', 'fgm', 'fga', 'fg_percentage', 'ftm', 'fta', 'ft_percentage', 'gp']);

const STAT_HEADERS = [
  { label: 'MIN', icon: '⏰' },
  { label: 'FGM', icon: '🎯' },
  { label: 'FGA', icon: '🏹' },
  { label: 'FG%', icon: '📈' },
  { label: 'FTM', icon: '🆓' },
  { label: 'FTA', icon: '🎯' },
  { label: 'FT%', icon: '📊' },
  { label: '3PM', icon: '🎯' },
  { label: 'REB', icon: '🏀' },
  { label: 'AST', icon: '🤝' },
  { label: 'STL', icon: '🥷' },
  { label: 'BLK', icon: '🛡️' },
  { label: 'PTS', icon: '🏀' },
  { label: 'GP', icon: '📅' }
] as const;



const toneStyles = (tone: 'win' | 'lose' | 'tie') => {
  if (tone === 'win') return { bg: 'bg-green-100', text: 'text-green-700', indicator: '↗' };
  if (tone === 'lose') return { bg: 'bg-red-100', text: 'text-red-700', indicator: '↘' };
  return { bg: 'bg-gray-100', text: 'text-gray-700', indicator: '=' };
};

const NeutralStat: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="tc-detail-stat">{children}</span>
);

const CategoryCell: React.FC<{
  lines: React.ReactNode;
  myZ: number | null | undefined;
  otherZ: number | null | undefined;
}> = ({ lines, myZ, otherZ }) => {
  const styles = toneStyles(categoryTone(myZ, otherZ));
  return (
    <div className={`${styles.bg} rounded p-1 text-center flex flex-col items-center justify-center min-h-[44px]`}>
      <div className={`font-semibold ${styles.text} text-xs leading-tight`}>{lines}</div>
      {myZ != null && (
        <span className={`${styles.text} text-[10px] font-medium`}>Z {signedCategoryZ(myZ)}</span>
      )}
      <span className={`${styles.text} text-[10px]`}>{styles.indicator}</span>
    </div>
  );
};

const StatValue: React.FC<StatValueProps> = ({ value, comparedTo, isPercentage = false, viewMode, field, lowerIsBetter = false }) => {
  const getValueStyles = () => {
    if (value === comparedTo) {
      return { bg: 'bg-gray-100', text: 'text-gray-700', indicator: '=' };
    }

    return (lowerIsBetter ? value < comparedTo : value > comparedTo)
      ? { bg: 'bg-green-100', text: 'text-green-700', indicator: '↗' }
      : { bg: 'bg-red-100', text: 'text-red-700', indicator: '↘' };
  };

  const styles = getValueStyles();
  const displayValue = (field === 'gp' || field === 'minutes')
    ? (viewMode === 'averages' && field === 'minutes' ? value.toFixed(1) : Math.round(value).toString())
    : formatStatValue(value, isPercentage, viewMode, false);

  return (
    <div className={`${styles.bg} rounded p-1 text-center flex flex-col items-center justify-center min-h-[44px]`}>
      <span className={`font-bold ${styles.text} text-xs leading-tight`}>
        {displayValue}
      </span>
      <span className={`${styles.text} text-[10px]`}>{styles.indicator}</span>
    </div>
  );
};

const TradeColumnPicker: React.FC<{
  columns: Column[];
  isShown: (key: string) => boolean;
  toggleColumn: (key: string) => void;
  showAllColumns: () => void;
  hideAllColumns: () => void;
}> = ({ columns, isShown, toggleColumn, showAllColumns, hideAllColumns }) => (
  <div className="mb-4 rounded-xl border border-[var(--tc-card-border)] bg-[var(--tc-card)] p-3">
    <div className="mb-2 flex gap-2">
      <button type="button" onClick={showAllColumns} className="tc-pill-toggle text-[10px]">Show all</button>
      <button type="button" onClick={hideAllColumns} className="tc-pill-toggle text-[10px]">Hide all</button>
    </div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {columns.map(({ key, label, icon }) => (
        <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--tc-text)] hover:bg-white/5">
          <input
            type="checkbox"
            checked={isShown(key)}
            onChange={() => toggleColumn(key)}
            className="rounded border-gray-500"
          />
          <span>{icon} {label}</span>
        </label>
      ))}
    </div>
  </div>
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
  // Opens on the scoring categories (FG/FT with made-attempted); minutes,
  // games and the made/attempted columns are one tap away.
  const [shownColumns, setShownColumns] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    STAT_KEYS.forEach(key => {
      initial[key] = !NON_CATEGORY_KEYS.has(key);
    });
    initial[COMPOSITE_FG] = true;
    initial[COMPOSITE_FT] = true;
    return initial;
  });

  const [isColumnControlsOpen, setIsColumnControlsOpen] = useState(false);

  // League categories beyond the fixed fields (e.g. TO) get their own columns,
  // placed before GP. None for a league on the standard 8 categories.
  const extraCategories = extraCountingCategories([...playersA, ...playersB]);
  const fixedColumns: Column[] = STAT_KEYS.map((key, index) => ({ key, ...STAT_HEADERS[index] }));
  const extraColumns: Column[] = extraCategories.map(category => ({
    key: `${EXTRA_COLUMN_PREFIX}${category}`, label: category, icon: '➕', extraCategory: category,
  }));
  const columns = [...fixedColumns.slice(0, -1), ...extraColumns, fixedColumns[fixedColumns.length - 1]];
  const isShown = (key: string) => shownColumns[key] ?? true;

  const toggleColumn = (key: string) => {
    setShownColumns(prev => ({
      ...prev,
      [key]: !(prev[key] ?? true)
    }));
  };

  const showAllColumns = () => {
    const allShown: Record<string, boolean> = {};
    columns.forEach(({ key }) => {
      allShown[key] = true;
    });
    setShownColumns(allShown);
  };

  const hideAllColumns = () => {
    const allHidden: Record<string, boolean> = {};
    columns.forEach(({ key }) => {
      allHidden[key] = false;
    });
    setShownColumns(allHidden);
  };

  const categoryKeys = categoryShortcutKeys(extraCategories);
  const categoriesOnly = isCategoriesOnlyView(isShown, extraCategories);
  const [beforeCategoriesOnly, setBeforeCategoriesOnly] = useState<Record<string, boolean> | null>(null);
  const toggleCategoriesOnly = () => {
    if (categoriesOnly) {
      if (beforeCategoriesOnly) setShownColumns(beforeCategoriesOnly);
      else showAllColumns();
      setBeforeCategoriesOnly(null);
      return;
    }
    setBeforeCategoriesOnly(shownColumns);
    const next: Record<string, boolean> = {};
    for (const key of categoryKeys) next[key] = true;
    for (const { key } of columns) next[key] = categoryKeys.has(key);
    next[COMPOSITE_FG] = true;
    next[COMPOSITE_FT] = true;
    setShownColumns(next);
  };

  // FG/FT made-attempted rows lead, then the picker's columns in order.
  const visibleColumns: DisplayColumn[] = [
    ...[COMPOSITE_FG, COMPOSITE_FT]
      .filter(key => shownColumns[key])
      .map(columnFromKey)
      .filter((c): c is DisplayColumn => c != null),
    ...columns
      .filter(({ key }) => isShown(key))
      .map(({ key, label, icon, extraCategory }) => ({ key, label, icon, extraCategory })),
  ];
  const contextShown = isShown('minutes') && isShown('gp');
  const toggleContext = () => setShownColumns(prev => ({ ...prev, minutes: !contextShown, gp: !contextShown }));
  const scoringColumns = visibleColumns.filter(c => scoringCategoryForColumn(c));
  const neutralColumns = visibleColumns.filter(c => isNeutralColumn(c.key));

  if (playersA.length === 0 && playersB.length === 0) {
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
  const aggregateExtras = viewMode === 'averages' ? aggregateExtraAverages : aggregateExtraTotals;
  const extraStatsA = aggregateExtras(getsA, extraCategories);
  const extraStatsB = aggregateExtras(getsB, extraCategories);

  const catZsA = tradeRanking?.referencePool.length
    ? tradeSideCategoryZs(getsA, tradeRanking.referencePool, tradeRanking.categories, tradeRanking.reverseCategories, viewMode)
    : null;
  const catZsB = tradeRanking?.referencePool.length
    ? tradeSideCategoryZs(getsB, tradeRanking.referencePool, tradeRanking.categories, tradeRanking.reverseCategories, viewMode)
    : null;

  const valueOf = (column: DisplayColumn, fixed: AggregatedStats, extras: Record<string, number>) =>
    column.extraCategory !== undefined
      ? extras[column.extraCategory]
      : fixed[column.key as keyof AggregatedStats];

  const categoryZ = (column: DisplayColumn, side: 'a' | 'b') => {
    const cat = scoringCategoryForColumn(column);
    if (!cat) return null;
    const map = side === 'a' ? catZsA : catZsB;
    return map?.[cat as keyof typeof map] ?? null;
  };

  const renderCell = (
    side: 'a' | 'b',
    column: DisplayColumn,
    fixed: AggregatedStats,
    extras: Record<string, number>,
    otherFixed: AggregatedStats,
    otherExtras: Record<string, number>,
  ) => {
    const myZ = categoryZ(column, side);
    const otherZ = categoryZ(column, side === 'a' ? 'b' : 'a');
    const cat = scoringCategoryForColumn(column);

    if (column.composite === 'fg') {
      return (
        <CategoryCell
          key={column.key}
          myZ={myZ}
          otherZ={otherZ}
          lines={(
            <>
              <span className="block font-bold">{formatBundlePct(fixed.fgm, fixed.fga)}</span>
              <span className="block text-[10px] font-normal">{formatMadeAttempted(fixed.fgm, fixed.fga, viewMode)}</span>
            </>
          )}
        />
      );
    }
    if (column.composite === 'ft') {
      return (
        <CategoryCell
          key={column.key}
          myZ={myZ}
          otherZ={otherZ}
          lines={(
            <>
              <span className="block font-bold">{formatBundlePct(fixed.ftm, fixed.fta)}</span>
              <span className="block text-[10px] font-normal">{formatMadeAttempted(fixed.ftm, fixed.fta, viewMode)}</span>
            </>
          )}
        />
      );
    }

    if (isNeutralColumn(column.key)) {
      const value = valueOf(column, fixed, extras);
      const isPercentage = column.key === 'fg_percentage' || column.key === 'ft_percentage';
      const displayValue = (column.key === 'gp' || column.key === 'minutes')
        ? (viewMode === 'averages' && column.key === 'minutes' ? value.toFixed(1) : Math.round(value).toString())
        : formatStatValue(value, isPercentage, viewMode, false);
      return <NeutralStat key={column.key}><span className="font-bold">{displayValue}</span></NeutralStat>;
    }

    const value = valueOf(column, fixed, extras);
    const otherVal = valueOf(column, otherFixed, otherExtras);
    const isPercentage = column.key === 'fg_percentage' || column.key === 'ft_percentage';

    if (cat && catZsA && catZsB) {
      const lines = isPercentage ? (
        <span className="block font-bold">{formatStatValue(value, true, viewMode, false)}</span>
      ) : (
        <span className="block font-bold">
          {formatStatValue(value, false, viewMode, false)}
        </span>
      );
      return <CategoryCell key={column.key} myZ={myZ} otherZ={otherZ} lines={lines} />;
    }

    return (
      <StatValue
        key={column.key}
        value={value}
        comparedTo={otherVal}
        viewMode={viewMode}
        isPercentage={isPercentage}
        field={column.key}
        lowerIsBetter={column.extraCategory !== undefined && KNOWN_REVERSE_CATEGORIES.has(column.extraCategory)}
      />
    );
  };

  const renderRow = (
    side: 'a' | 'b',
    fixed: AggregatedStats,
    extras: Record<string, number>,
    otherFixed: AggregatedStats,
    otherExtras: Record<string, number>,
    cols: DisplayColumn[] = visibleColumns,
  ) => cols.map(column => renderCell(side, column, fixed, extras, otherFixed, otherExtras));

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
      { heading: 'Drop', players: sharePlayers(playersA) },
      { heading: 'Add', players: sharePlayers(playersB) },
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
              onClick={() => setIsColumnControlsOpen(!isColumnControlsOpen)}
              className="tc-pill-toggle"
              aria-expanded={isColumnControlsOpen}
            >
              {isColumnControlsOpen ? '▼' : '▶'} Columns
            </button>
            <button
              type="button"
              onClick={toggleCategoriesOnly}
              aria-pressed={categoriesOnly}
              className="tc-pill-toggle"
              title="Show only the scoring categories; click again for the columns you had before"
            >
              {categoryKeys.size} cats only
            </button>
            <button
              type="button"
              onClick={toggleContext}
              aria-pressed={contextShown}
              className="tc-pill-toggle"
              title="Minutes and games played aren't scored; shown for context"
            >
              {contextShown ? 'Hide' : 'Show'} minutes and games
            </button>
          </div>
          {isColumnControlsOpen && (
            <TradeColumnPicker
              columns={columns}
              isShown={isShown}
              toggleColumn={toggleColumn}
              showAllColumns={showAllColumns}
              hideAllColumns={hideAllColumns}
            />
          )}
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
              compositeShooting={categoriesOnly}
              proLayout
            />
          )}
          {neutralColumns.length > 0 && (
            <TradeDetailGrid
              neutralColumns={neutralColumns}
              teamAName={teamA?.team_name || (tradeMode === 'freeAgent' ? 'Your Team' : 'Team A')}
              teamBName={tradeMode === 'freeAgent' ? 'Free Agents' : (teamB?.team_name || 'Team B')}
              rowA={renderRow('a', displayGetsA, extraStatsA, displayGetsB, extraStatsB, neutralColumns)}
              rowB={renderRow('b', displayGetsB, extraStatsB, displayGetsA, extraStatsA, neutralColumns)}
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