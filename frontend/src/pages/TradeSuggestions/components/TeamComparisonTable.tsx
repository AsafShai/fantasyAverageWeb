import React, { useMemo } from 'react';
import { formatStatValue, getComparisonColor, getComparisonIcon } from '../utils/tradeHelpers';
import type { PlayerGroup } from '../utils/tradeHelpers';
import { aggregatePlayerStats } from '../../Trade/utils/tradeCalculations';
import { CollapsibleTable } from '../../../components/CollapsibleTable';

interface StatColumn {
  key: string;
  label: string;
  mobile: boolean;
  isPercentage?: boolean;
  isGamesPlayed?: boolean;
}

interface TeamComparisonTableProps {
  playerGroups: PlayerGroup[];
  viewMode: 'totals' | 'averages';
}

export const TeamComparisonTable: React.FC<TeamComparisonTableProps> = ({
  playerGroups,
  viewMode,
}) => {
  const statColumns: StatColumn[] = [
    { key: 'gp', label: 'GP', mobile: false, isGamesPlayed: true },
    { key: 'pts', label: 'PTS', mobile: true },
    { key: 'reb', label: 'REB', mobile: true },
    { key: 'ast', label: 'AST', mobile: true },
    { key: 'stl', label: 'STL', mobile: false },
    { key: 'blk', label: 'BLK', mobile: false },
    { key: 'three_pm', label: '3PM', mobile: false },
    { key: 'fg_percentage', label: 'FG%', mobile: false, isPercentage: true },
    { key: 'ft_percentage', label: 'FT%', mobile: false, isPercentage: true },
  ];

  const aggregatedStats = useMemo(() => {
    return playerGroups.map((group) => ({
      team: group.team,
      stats: aggregatePlayerStats(group.players),
    }));
  }, [playerGroups]);

  const formatTeamStat = (stats: any, statKey: string, isPercentage: boolean = false, isGamesPlayed: boolean = false) => {
    const value = stats[statKey] || 0;
    const gamesPlayed = stats.gp || 1;
    
    if (isGamesPlayed) {
      return formatStatValue(value, gamesPlayed, viewMode, false, true);
    }
    
    if (isPercentage) {
      return formatStatValue(value, gamesPlayed, 'totals', true);
    }
    
    return formatStatValue(value, gamesPlayed, viewMode, false);
  };

  const getStatComparison = (value1: number, value2: number, isHigherBetter: boolean = true) => {
    if (value1 === value2) return 'neutral';
    if (isHigherBetter) {
      return value1 > value2 ? 'better' : 'worse';
    } else {
      return value1 < value2 ? 'better' : 'worse';
    }
  };

  const getStatComparisonClass = (comparison: 'better' | 'worse' | 'neutral') => {
    switch (comparison) {
      case 'better':
        return 'text-green-700 font-bold';
      case 'worse':
        return 'text-red-700 font-bold';
      case 'neutral':
      default:
        return 'font-bold';
    }
  };

  const getStatValue = (stats: any, statKey: string) => {
    const value = stats[statKey] || 0;
    const gamesPlayed = stats.gp
    
    if (viewMode === 'averages') {
      return gamesPlayed > 0 ? value / gamesPlayed : 0;
    }
    
    return value;
  };

  const calculateDifference = (receivingStats: any, givingStats: any, statKey: string) => {
    const receivingValue = receivingStats[statKey] || 0;
    const givingValue = givingStats[statKey] || 0;
    
    // Special handling for GP - always use total values
    if (statKey === 'gp') {
      return receivingValue - givingValue;
    }
    
    if (viewMode === 'averages') {
      const receivingGP = receivingStats.gp;
      const givingGP = givingStats.gp;
      const receivingAvg = receivingGP === 0 ? 0 : receivingValue / receivingGP;
      const givingAvg = givingGP === 0 ? 0 : givingValue / givingGP;
      return receivingAvg - givingAvg;
    }
    
    return receivingValue - givingValue;
  };

  if (aggregatedStats.length !== 2) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-gray-50">
          <h3 className="font-medium text-gray-900">Team vs Team Comparison</h3>
        </div>
        <div className="p-4 text-center text-gray-500">
          Unable to generate comparison with available data
        </div>
      </div>
    );
  }

  const [givingTeam, receivingTeam] = aggregatedStats;

  return (
    <CollapsibleTable
      title="Team vs Team Comparison"
      collapsedLabel="View statistical impact of the trade"
      defaultExpanded={true}
    >
      
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-900 border-b">Team</th>
              {statColumns.map((col) => (
                <th
                  key={col.key}
                  className={`px-3 py-2 text-center font-medium text-gray-900 border-b ${
                    !col.mobile ? 'hidden sm:table-cell' : ''
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-slate-50">
              <td className="px-3 py-2 font-medium text-slate-700 border-b border-gray-200">
                Giving ({givingTeam.team.team_name})
              </td>
              {statColumns.map((col) => {
                const givingValue = getStatValue(givingTeam.stats, col.key);
                const receivingValue = getStatValue(receivingTeam.stats, col.key);
                const comparison = getStatComparison(givingValue, receivingValue, true);
                const comparisonClass = getStatComparisonClass(comparison);
                
                return (
                  <td
                    key={col.key}
                    className={`px-3 py-2 text-center border-b border-gray-200 ${
                      !col.mobile ? 'hidden sm:table-cell' : ''
                    }`}
                  >
                    <span className={comparisonClass}>
                      {formatTeamStat(givingTeam.stats, col.key, col.isPercentage || false, col.isGamesPlayed || false)}
                    </span>
                  </td>
                );
              })}
            </tr>
            
            <tr className="bg-amber-50">
              <td className="px-3 py-2 font-medium text-amber-700 border-b border-gray-200">
                Receiving ({receivingTeam.team.team_name})
              </td>
              {statColumns.map((col) => {
                const givingValue = getStatValue(givingTeam.stats, col.key);
                const receivingValue = getStatValue(receivingTeam.stats, col.key);
                const comparison = getStatComparison(receivingValue, givingValue, true);
                const comparisonClass = getStatComparisonClass(comparison);
                
                return (
                  <td
                    key={col.key}
                    className={`px-3 py-2 text-center border-b border-gray-200 ${
                      !col.mobile ? 'hidden sm:table-cell' : ''
                    }`}
                  >
                    <span className={comparisonClass}>
                      {formatTeamStat(receivingTeam.stats, col.key, col.isPercentage || false, col.isGamesPlayed || false)}
                    </span>
                  </td>
                );
              })}
            </tr>
            
            <tr className="bg-blue-50">
              <td className="px-3 py-2 font-medium text-blue-700 border-b border-gray-200">
                Net Impact
              </td>
              {statColumns.map((col) => {
                const difference = calculateDifference(receivingTeam.stats, givingTeam.stats, col.key);
                const color = getComparisonColor(difference);
                const icon = getComparisonIcon(difference);
                
                return (
                  <td
                    key={col.key}
                    className={`px-3 py-2 text-center border-b border-gray-200 ${color} ${
                      !col.mobile ? 'hidden sm:table-cell' : ''
                    }`}
                  >
                    <div className="flex items-center justify-center space-x-1">
                      <span>{icon}</span>
                      <span className="font-bold">
                        {difference > 0 ? '+' : ''}
                        {col.isGamesPlayed || false
                          ? Math.round(difference).toString()
                          : col.isPercentage || false 
                            ? difference.toFixed(4) + '%'
                            : viewMode === 'averages' 
                              ? difference.toFixed(4) 
                              : Math.round(difference).toString()
                        }
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      
      <div className="p-4 bg-gray-50 border-t">
        <div className="flex justify-center space-x-6 text-xs text-gray-600">
          <div className="flex items-center space-x-1">
            <span className="text-green-600">↗️</span>
            <span>Positive Impact</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="text-gray-600">→</span>
            <span>Neutral Impact</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="text-red-600">↘️</span>
            <span>Negative Impact</span>
          </div>
        </div>
      </div>
    </CollapsibleTable>
  );
};