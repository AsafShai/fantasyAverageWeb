import React from 'react';
import type { Player, PlayerStats } from '../../../types/api';
import { calculatePlayerAverages, formatStatValue, getStatColor } from '../utils/tradeCalculations';

interface PlayerStatsCardProps {
  player: Player;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  showStats?: boolean;
  viewMode?: 'totals' | 'averages';
}

interface StatsItemData {
  label: string;
  value: number;
  icon: string;
  isPercentage?: boolean;
  field: keyof PlayerStats;
}

type StatItemProps = StatsItemData & { viewMode: 'totals' | 'averages' }

const StatItem: React.FC<StatItemProps> = ({ 
  label, 
  value, 
  icon,
  isPercentage = false,
  viewMode = 'totals',
  field,
}) => (
  <div className="flex flex-col items-center p-1 bg-gray-50 rounded text-center">
    <div className="flex items-center space-x-0.5 mb-0.5">
      <span className="text-xs">{icon}</span>
      <span className="text-xs font-medium text-gray-600">{label}</span>
    </div>
    <span className={`text-xs font-bold ${getStatColor(value, isPercentage)}`}>
      {field !== 'gp' ? formatStatValue(value, isPercentage, viewMode) : value}
    </span>
  </div>
);

export const PlayerStatsCard: React.FC<PlayerStatsCardProps> = ({
  player,
  isSelected,
  onSelect,
  onRemove,
  showStats = false,
  viewMode = 'totals',
}) => {
  const displayStats = viewMode === 'averages' 
    ? calculatePlayerAverages(player.stats)
    : player.stats;

  const statsItemsData: StatsItemData[] = [
    { label: "Min", value: displayStats.minutes, icon: "⏱️", field: "minutes" },
    { label: "PTS", value: displayStats.pts, icon: "🏀", field: "pts" },
    { label: "REB", value: displayStats.reb, icon: "🏀", field: "reb" },
    { label: "AST", value: displayStats.ast, icon: "🤝", field: "ast" },
    { label: "STL", value: displayStats.stl, icon: "🥷", field: "stl" },
    { label: "BLK", value: displayStats.blk, icon: "🛡️", field: "blk" },
    { label: "3PM", value: displayStats.three_pm, icon: "🎯", field: "three_pm" },
    { label: "FGM", value: displayStats.fgm, icon: "🎯", field: "fgm" },
    { label: "FGA", value: displayStats.fga, icon: "🏹", field: "fga" },
    { label: "FG%", value: displayStats.fg_percentage, icon: "📈", isPercentage: true, field: "fg_percentage" },
    { label: "FTM", value: displayStats.ftm, icon: "🆓", field: "ftm" },
    { label: "FTA", value: displayStats.fta, icon: "🎯", field: "fta" },
    { label: "FT%", value: displayStats.ft_percentage, icon: "📊", isPercentage: true, field: "ft_percentage" },
    { label: "GP", value: displayStats.gp, icon: "📅", field: "gp" }
  ]

  if (showStats) {
    return (
      <div className="bg-white rounded-lg p-2 border border-gray-200 shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <h4 className="text-md font-bold text-gray-900">{player.player_name}</h4>
              <button
                onClick={onRemove}
                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded-full transition-colors"
                title="Remove player"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="flex items-center space-x-2 mb-2">
              <div className="flex space-x-1">
                {player.positions.map((pos) => (
                  <span key={pos} className="bg-blue-100 text-blue-800 px-1 py-0.5 rounded text-xs font-medium">
                    {pos}
                  </span>
                ))}
              </div>
              <span className="text-xs text-gray-500">{player.pro_team}</span>
              <span className="text-xs text-gray-400">•</span>
              <span className="text-xs text-gray-500">{player.stats.gp} GP</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-14 gap-1">
          {statsItemsData.map((stat) => (
            <StatItem
              key={stat.label}
              label={stat.label}
              value={stat.value}
              icon={stat.icon}
              isPercentage={stat.isPercentage}
              viewMode={viewMode}
              field={stat.field}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center p-3 hover:bg-gray-50 rounded-lg transition-colors">
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onSelect}
        className="mr-3 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
      />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <span className="font-medium text-gray-900">{player.player_name}</span>
              <div className="flex items-center space-x-2 mt-1">
                <div className="flex space-x-1">
                  {player.positions.map((pos) => (
                    <span key={pos} className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs">
                      {pos}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-gray-500">{player.pro_team}</span>
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-medium text-gray-900">
              {formatStatValue(displayStats.pts, false, viewMode)} PTS
            </div>
            <div className="text-xs text-gray-500">
              {formatStatValue(displayStats.reb, false, viewMode)} REB • {formatStatValue(displayStats.ast, false, viewMode)} AST
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};