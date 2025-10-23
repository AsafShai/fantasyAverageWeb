import React from 'react';
import type { Player, Team } from '../../../types/api';
import type { TradeMode } from '../../../hooks/useTradeState';
import {
  aggregatePlayerStats,
  calculateTeamAverages,
  formatStatValue
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
  field: (typeof STAT_KEYS)[number];
}

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



const StatValue: React.FC<StatValueProps> = ({ value, comparedTo, isPercentage = false, viewMode, field }) => {
  const getValueStyles = () => {
    if (value === comparedTo) {
      return { bg: 'bg-gray-100', text: 'text-gray-700', indicator: '=' };
    }

    return value > comparedTo
      ? { bg: 'bg-green-100', text: 'text-green-700', indicator: '↗' }
      : { bg: 'bg-red-100', text: 'text-red-700', indicator: '↘' };
  };

  const styles = getValueStyles();
  const displayValue = (field === 'gp' || field === 'minutes')
    ? (viewMode === 'averages' && field === 'minutes' ? value.toFixed(1) : Math.round(value).toString())
    : formatStatValue(value, isPercentage, viewMode);

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

  const statsA = aggregatePlayerStats(playersA);
  const statsB = aggregatePlayerStats(playersB);
  const displayStatsA = viewMode === 'averages' ? calculateTeamAverages(statsA) : statsA;
  const displayStatsB = viewMode === 'averages' ? calculateTeamAverages(statsB) : statsB;

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
          
          <div className="w-full overflow-x-auto">
            <div className="grid gap-1" style={{ gridTemplateColumns: '220px repeat(14, minmax(42px, 1fr))' }}>
              {/* Header row */}
              <div className="font-semibold text-gray-700 p-2 text-sm">Team</div>
              {STAT_HEADERS.map(({ label, icon }) => (
                <div key={label} className="font-semibold text-gray-700 p-2 text-center text-xs leading-tight">
                  <div className="text-sm">{icon}</div>
                  <div>{label}</div>
                </div>
              ))}

              <div className="bg-blue-50 rounded p-2 font-medium text-gray-800 flex items-center text-sm">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={teamA?.team_name || (tradeMode === 'freeAgent' ? 'Your Team' : 'Team A')}>
                  {teamA?.team_name || (tradeMode === 'freeAgent' ? 'Your Team' : 'Team A')}
                </span>
              </div>
              {STAT_KEYS.map((key) => {
                const isPercentage = key === 'fg_percentage' || key === 'ft_percentage';
                return (
                  <StatValue
                    key={key}
                    value={displayStatsA[key as keyof typeof displayStatsA]}
                    comparedTo={displayStatsB[key as keyof typeof displayStatsB]}
                    viewMode={viewMode}
                    isPercentage={isPercentage}
                    field={key}
                  />
                );
              })}

              <div className="bg-green-50 rounded p-2 font-medium text-gray-800 flex items-center text-sm">
                <span className="overflow-hidden text-ellipsis whitespace-nowrap" title={tradeMode === 'freeAgent' ? 'Free Agents' : (teamB?.team_name || 'Team B')}>
                  {tradeMode === 'freeAgent' ? 'Free Agents' : (teamB?.team_name || 'Team B')}
                </span>
              </div>
              {STAT_KEYS.map((key) => {
                const isPercentage = key === 'fg_percentage' || key === 'ft_percentage';
                return (
                  <StatValue 
                    key={key}
                    value={displayStatsB[key as keyof typeof displayStatsB]} 
                    comparedTo={displayStatsA[key as keyof typeof displayStatsA]} 
                    viewMode={viewMode} 
                    isPercentage={isPercentage}
                    field={key}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});