import React from 'react';

export type TimePeriod = 'season' | 'last_7' | 'last_15' | 'last_30';

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
}

const TimePeriodSelector: React.FC<TimePeriodSelectorProps> = ({ value, onChange }) => {
  const periods: { value: TimePeriod; label: string; emoji: string }[] = [
    { value: 'season', label: 'Full Season', emoji: '📅' },
    { value: 'last_7', label: 'Last 7 Days', emoji: '🔥' },
    { value: 'last_15', label: 'Last 15 Days', emoji: '📊' },
    { value: 'last_30', label: 'Last 30 Days', emoji: '📈' },
  ];

  return (
    <div className="bg-gray-100 p-2 rounded-lg grid grid-cols-2 sm:grid-cols-4 gap-2 w-auto max-w-sm sm:max-w-none mb-3 sm:mb-0">
      {periods.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap ${
            value === period.value
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          <span className="mr-1">{period.emoji}</span>
          {period.label}
        </button>
      ))}
    </div>
  );
};

export default TimePeriodSelector;
