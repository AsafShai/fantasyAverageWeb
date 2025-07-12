import React from 'react';
import type { Player, Team } from '../../../types/api';
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
}

interface StatValueProps {
  value: number;
  comparedTo: number;
  isPercentage?: boolean;
  viewMode: 'totals' | 'averages';
}

const STAT_HEADERS = [
  { label: 'PTS', icon: '🏀' },
  { label: 'REB', icon: '🏀' },
  { label: 'AST', icon: '🤝' },
  { label: 'STL', icon: '🥷' },
  { label: 'BLK', icon: '🛡️' },
  { label: '3PM', icon: '🎯' },
  { label: 'FGM', icon: '🎯' },
  { label: 'FGA', icon: '🏹' },
  { label: 'FG%', icon: '📈' },
  { label: 'FTM', icon: '🆓' },
  { label: 'FTA', icon: '🎯' },
  { label: 'FT%', icon: '📊' },
  { label: 'GP', icon: '📅' }
] as const;



const StatValue: React.FC<StatValueProps> = ({ value, comparedTo, isPercentage = false, viewMode }) => {
  const getValueStyles = () => {
    const diff = Math.abs(value - comparedTo);
    const threshold = isPercentage ? 0.01 : 0.1;
    
    if (diff < threshold) {
      return { bg: 'bg-gray-100', text: 'text-gray-700', indicator: '=' };
    }
    
    return value > comparedTo 
      ? { bg: 'bg-green-100', text: 'text-green-700', indicator: '↗' }
      : { bg: 'bg-red-100', text: 'text-red-700', indicator: '↘' };
  };

  const styles = getValueStyles();

  return (
    <div className={`${styles.bg} rounded p-1 text-center flex items-center justify-center space-x-1`}>
      <span className={`font-bold ${styles.text} text-xs`}>
        {formatStatValue(value, isPercentage, viewMode)}
      </span>
      <span className={`${styles.text} text-xs`}>{styles.indicator}</span>
    </div>
  );
};


export const TradeSummaryPanel: React.FC<TradeSummaryPanelProps> = React.memo(({
  teamA,
  teamB,
  playersA,
  playersB,
  viewMode,
}) => {
  if (playersA.length === 0 && playersB.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-4xl mb-4">🔄</div>
        <h3 className="text-lg font-medium mb-2">No Trade Selected</h3>
        <p className="text-sm">Select players from both teams to see trade analysis</p>
      </div>
    );
  }

  const statsA = aggregatePlayerStats(playersA);
  const statsB = aggregatePlayerStats(playersB);
  const displayStatsA = viewMode === 'averages' ? calculateTeamAverages(statsA) : statsA;
  const displayStatsB = viewMode === 'averages' ? calculateTeamAverages(statsB) : statsB;

  return (
    <div className="space-y-6">
      {playersA.length > 0 && playersB.length > 0 && (
        <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            📊 Trade Comparison
          </h2>
          
          <div className="overflow-x-auto">
            <div className="grid grid-cols-[150px_repeat(13,1fr)] gap-1 min-w-[1400px]">
              {/* Header row */}
              <div className="font-semibold text-gray-700 p-2 text-sm">Team</div>
              {STAT_HEADERS.map(({ label, icon }) => (
                <div key={label} className="font-semibold text-gray-700 p-2 text-center text-xs">
                  {icon} {label}
                </div>
              ))}
              
              <div className="bg-blue-50 rounded p-2 font-medium text-gray-800 flex items-center text-sm">
                {teamA?.team_name || 'Team A'}
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
                  />
                );
              })}
              
              <div className="bg-green-50 rounded p-2 font-medium text-gray-800 flex items-center text-sm">
                {teamB?.team_name || 'Team B'}
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