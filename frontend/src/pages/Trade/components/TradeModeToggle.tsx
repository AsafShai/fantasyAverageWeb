import React from 'react';

export type TradeMode = 'team' | 'freeAgent';

interface TradeModeToggleProps {
  mode: TradeMode;
  onToggle: (mode: TradeMode) => void;
}

export const TradeModeToggle: React.FC<TradeModeToggleProps> = ({ mode, onToggle }) => {
  return (
    <div className="flex items-center justify-center mb-3">
      <div className="bg-gray-100 p-1.5 rounded-lg flex">
        <button
          onClick={() => onToggle('team')}
          className={`px-6 py-2.5 rounded-md text-base font-semibold transition-all duration-200 ${
            mode === 'team'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          🔄 Team vs Team
        </button>
        <button
          onClick={() => onToggle('freeAgent')}
          className={`px-6 py-2.5 rounded-md text-base font-semibold transition-all duration-200 ${
            mode === 'freeAgent'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          🆓 Team vs Free Agents
        </button>
      </div>
    </div>
  );
};
