import React from 'react';

interface TradeStatsToggleProps {
  viewMode: 'totals' | 'averages';
  onToggle: (mode: 'totals' | 'averages') => void;
}

export const TradeStatsToggle: React.FC<TradeStatsToggleProps> = ({ viewMode, onToggle }) => {
  return (
    <div className="flex items-center justify-center mb-3">
      <div className="bg-gray-100 p-1 rounded-lg flex">
        <button
          onClick={() => onToggle('totals')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
            viewMode === 'totals'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          📊 Total Stats
        </button>
        <button
          onClick={() => onToggle('averages')}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
            viewMode === 'averages'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          📈 Per Game Averages
        </button>
      </div>
    </div>
  );
};