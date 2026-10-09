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

interface TradeSummaryPanelProps {
  teamA: Team | null;
  teamB: Team | null;
  playersA: Player[];
  playersB: Player[];
  viewMode: 'totals' | 'averages';
  tradeMode: TradeMode;
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


export const TradeSummaryPanel: React.FC<TradeSummaryPanelProps> = React.memo(({
  teamA,
  teamB,
  playersA,
  playersB,
  viewMode,
  tradeMode,
}) => {
  const [shownColumns, setShownColumns] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    STAT_KEYS.forEach(key => {
      initial[key] = true;
    });
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

  const visibleColumns = columns.filter(({ key }) => isShown(key));

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

  const displayStatsA = viewMode === 'averages'
    ? aggregatePlayerAverages(playersA)
    : aggregatePlayerStats(playersA);
  const displayStatsB = viewMode === 'averages'
    ? aggregatePlayerAverages(playersB)
    : aggregatePlayerStats(playersB);
  const aggregateExtras = viewMode === 'averages' ? aggregateExtraAverages : aggregateExtraTotals;
  const extraStatsA = aggregateExtras(playersA, extraCategories);
  const extraStatsB = aggregateExtras(playersB, extraCategories);

  const valueOf = (column: Column, fixed: typeof displayStatsA, extras: Record<string, number>) =>
    column.extraCategory !== undefined
      ? extras[column.extraCategory]
      : fixed[column.key as keyof typeof fixed];

  const renderRow = (
    fixed: typeof displayStatsA, extras: Record<string, number>,
    otherFixed: typeof displayStatsA, otherExtras: Record<string, number>,
  ) => visibleColumns.map((column) => {
    const isPercentage = column.key === 'fg_percentage' || column.key === 'ft_percentage';
    return (
      <StatValue
        key={column.key}
        value={valueOf(column, fixed, extras)}
        comparedTo={valueOf(column, otherFixed, otherExtras)}
        viewMode={viewMode}
        isPercentage={isPercentage}
        field={column.key}
        lowerIsBetter={column.extraCategory !== undefined && KNOWN_REVERSE_CATEGORIES.has(column.extraCategory)}
      />
    );
  });

  const comparisonTitle = tradeMode === 'freeAgent'
    ? '📊 Player Comparison: Your Team vs Free Agents'
    : '📊 Trade Comparison';

  return (
    <div className="space-y-6">
      {playersA.length > 0 && playersB.length > 0 && (
        <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            {comparisonTitle}
          </h2>

          {/* Show/Hide Columns Control */}
          <div className="mb-6">
            <button
              onClick={() => setIsColumnControlsOpen(!isColumnControlsOpen)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              <span>{isColumnControlsOpen ? '▼' : '▶'}</span>
              <span>Show/Hide Columns</span>
            </button>

            {isColumnControlsOpen && (
              <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex gap-3 mb-3">
                  <button
                    onClick={showAllColumns}
                    className="px-3 py-1 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 rounded transition-colors"
                  >
                    Show All
                  </button>
                  <button
                    onClick={hideAllColumns}
                    className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded transition-colors"
                  >
                    Hide All
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {columns.map(({ key, label, icon }) => {
                    return (
                      <label
                        key={key}
                        className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 p-2 rounded transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isShown(key)}
                          onChange={() => toggleColumn(key)}
                          className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm">
                          {icon} {label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="w-full overflow-x-auto">
            <div className="grid gap-1" style={{ gridTemplateColumns: `220px repeat(${visibleColumns.length}, minmax(60px, 1fr))` }}>
              {/* Header row */}
              <div className="font-semibold text-gray-700 p-2 text-sm">Team</div>
              {visibleColumns.map(({ key, label, icon }) => (
                <div key={key} className="font-semibold text-gray-700 p-2 text-center text-xs leading-tight">
                  <div className="text-sm">{icon}</div>
                  <div>{label}</div>
                </div>
              ))}

              <div className="bg-blue-50 rounded p-2 font-medium text-gray-800 flex items-center text-sm">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={teamA?.team_name || (tradeMode === 'freeAgent' ? 'Your Team' : 'Team A')}>
                  {teamA?.team_name || (tradeMode === 'freeAgent' ? 'Your Team' : 'Team A')}
                </span>
              </div>
              {renderRow(displayStatsA, extraStatsA, displayStatsB, extraStatsB)}

              <div className="bg-green-50 rounded p-2 font-medium text-gray-800 flex items-center text-sm">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={tradeMode === 'freeAgent' ? 'Free Agents' : (teamB?.team_name || 'Team B')}>
                  {tradeMode === 'freeAgent' ? 'Free Agents' : (teamB?.team_name || 'Team B')}
                </span>
              </div>
              {renderRow(displayStatsB, extraStatsB, displayStatsA, extraStatsA)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});