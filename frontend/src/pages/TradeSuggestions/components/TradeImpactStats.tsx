import React, { useMemo } from 'react';
import type { Player } from '../../../types/api';

interface TradeImpactStatsProps {
  playersToGive: Player[];
  playersToReceive: Player[];
  viewMode: 'totals' | 'averages';
}

export const TradeImpactStats: React.FC<TradeImpactStatsProps> = ({
  playersToGive,
  playersToReceive,
  viewMode,
}) => {
  const calculateTotalStats = useMemo(() => {
    return (players: Player[]) => {
      if (!players || players.length === 0) {
        return {
          pts: 0,
          reb: 0,
          ast: 0,
          stl: 0,
          blk: 0,
          three_pm: 0,
          gp: 0,
        };
      }
      
      return players.reduce(
        (totals, player) => ({
          pts: (totals.pts || 0) + (player.stats?.pts || 0),
          reb: (totals.reb || 0) + (player.stats?.reb || 0),
          ast: (totals.ast || 0) + (player.stats?.ast || 0),
          stl: (totals.stl || 0) + (player.stats?.stl || 0),
          blk: (totals.blk || 0) + (player.stats?.blk || 0),
          three_pm: (totals.three_pm || 0) + (player.stats?.three_pm || 0),
          gp: (totals.gp || 0) + (player.stats?.gp || 0),
        }),
        {} as Record<string, number>
      );
    };
  }, []);

  const getDisplayValue = (value: number, totalGames: number) => {
    if (viewMode === 'averages' && totalGames > 0) {
      return (value / totalGames).toFixed(4);
    }
    return Math.round(value).toString();
  };

  const givingStats = useMemo(() => calculateTotalStats(playersToGive), [calculateTotalStats, playersToGive]);
  const receivingStats = useMemo(() => calculateTotalStats(playersToReceive), [calculateTotalStats, playersToReceive]);

  const statCategories = [
    { key: 'pts', label: 'Points', suffix: '' },
    { key: 'reb', label: 'Rebounds', suffix: '' },
    { key: 'ast', label: 'Assists', suffix: '' },
    { key: 'stl', label: 'Steals', suffix: '' },
    { key: 'blk', label: 'Blocks', suffix: '' },
    { key: 'three_pm', label: '3-Pointers', suffix: '' },
  ];

  const getImpactColor = (diff: number) => {
    if (Math.abs(diff) < 0.5) return 'text-gray-600';
    return diff > 0 ? 'text-green-600' : 'text-red-600';
  };

  const getImpactIcon = (diff: number) => {
    if (Math.abs(diff) < 0.5) return '→';
    return diff > 0 ? '↗️' : '↘️';
  };

  return (
    <div>
      <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
        <span className="mr-2">📈</span>
        Statistical Impact Analysis
      </h4>

      <div className="bg-gray-50 rounded-lg p-4">
        <div className="grid gap-3">
          {statCategories.map((category) => {
            const giving = givingStats[category.key] || 0;
            const receiving = receivingStats[category.key] || 0;
            
            const givingDisplay = parseFloat(getDisplayValue(giving, givingStats.gp || 1));
            const receivingDisplay = parseFloat(getDisplayValue(receiving, receivingStats.gp || 1));
            const difference = receivingDisplay - givingDisplay;

            return (
              <div
                key={category.key}
                className="flex items-center justify-between py-2 px-3 bg-white rounded-md"
              >
                <div className="flex-1">
                  <span className="font-medium text-gray-700">{category.label}</span>
                </div>
                
                <div className="flex items-center space-x-6 text-sm">
                  <div className="text-center min-w-[60px]">
                    <div className="text-red-600 font-medium">
                      -{viewMode === 'averages' ? givingDisplay.toFixed(4) : Math.round(givingDisplay).toString()}{category.suffix}
                    </div>
                    <div className="text-xs text-gray-500">Giving</div>
                  </div>

                  <div className="text-gray-400">→</div>

                  <div className="text-center min-w-[60px]">
                    <div className="text-green-600 font-medium">
                      +{viewMode === 'averages' ? receivingDisplay.toFixed(4) : Math.round(receivingDisplay).toString()}{category.suffix}
                    </div>
                    <div className="text-xs text-gray-500">Receiving</div>
                  </div>

                  <div className="text-center min-w-[80px]">
                    <div className={`font-semibold flex items-center justify-center space-x-1 ${getImpactColor(difference)}`}>
                      <span>{getImpactIcon(difference)}</span>
                      <span>
                        {difference > 0 ? '+' : ''}{viewMode === 'averages' ? difference.toFixed(4) : Math.round(difference).toString()}{category.suffix}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">Net Change</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="text-center">
            <h5 className="font-medium text-gray-800 mb-2">Trade Impact Summary</h5>
            <div className="flex justify-center space-x-6 text-sm">
              <div className="flex items-center space-x-1">
                <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                <span className="text-gray-600">Positive Impact</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-3 h-3 bg-gray-400 rounded-full"></span>
                <span className="text-gray-600">Neutral Impact</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                <span className="text-gray-600">Negative Impact</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};