import React, { useEffect, useRef, useState } from 'react';
import { useGetLeagueSummaryQuery } from '../store/api/fantasyApi';
import { FF_CUSTOM_RANGE } from '../config/featureFlags';
import DateRangePicker from './DateRangePicker';
import type { CustomDateRange } from '../types/api';

export type TimePeriod = 'season' | 'last_7' | 'last_15' | 'last_30' | 'custom';

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  customRange?: CustomDateRange | null;
  onCustomRangeChange?: (range: CustomDateRange | null) => void;
  allowCustom?: boolean;
}

const formatRangeLabel = (range: CustomDateRange) => {
  const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(range.start)} – ${fmt(range.end)}`;
};

const TimePeriodSelector: React.FC<TimePeriodSelectorProps> = ({
  value,
  onChange,
  customRange = null,
  onCustomRangeChange,
  allowCustom = true,
}) => {
  const showCustom = FF_CUSTOM_RANGE && allowCustom;
  const { data: summary } = useGetLeagueSummaryQuery(undefined, { skip: !showCustom });
  const [panelOpen, setPanelOpen] = useState(false);
  const prevPeriodRef = useRef<TimePeriod>(value === 'custom' ? 'season' : value);

  useEffect(() => {
    if (value !== 'custom') prevPeriodRef.current = value;
  }, [value]);

  const periods: { value: TimePeriod; label: string; shortLabel: string; emoji: string }[] = [
    { value: 'season', label: 'Full Season', shortLabel: 'Season', emoji: '📅' },
    { value: 'last_7', label: 'Last 7 Days', shortLabel: 'L7', emoji: '🔥' },
    { value: 'last_15', label: 'Last 15 Days', shortLabel: 'L15', emoji: '📊' },
    { value: 'last_30', label: 'Last 30 Days', shortLabel: 'L30', emoji: '📈' },
  ];

  const handleApply = (range: CustomDateRange) => {
    onCustomRangeChange?.(range);
    onChange('custom');
    setPanelOpen(false);
  };

  const handleClearChip = () => {
    onCustomRangeChange?.(null);
    onChange(prevPeriodRef.current);
    setPanelOpen(false);
  };

  return (
    <div className="mb-3 sm:mb-0">
      <div className="bg-gray-100 p-1 rounded-lg flex flex-wrap gap-1.5 w-auto max-w-sm sm:max-w-none">
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
            <span className="sm:hidden">{period.shortLabel}</span>
            <span className="hidden sm:inline">{period.label}</span>
          </button>
        ))}
        {showCustom && (
          <button
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap border border-dashed ${
              value === 'custom'
                ? 'bg-white text-blue-600 shadow-sm border-blue-300'
                : 'text-gray-600 hover:text-gray-800 border-gray-400'
            }`}
          >
            <span className="mr-1">📆</span>
            Custom
          </button>
        )}
      </div>

      {showCustom && value === 'custom' && customRange && !panelOpen && (
        <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/30 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          {formatRangeLabel(customRange)}
          <button
            onClick={handleClearChip}
            aria-label="Clear custom range"
            className="ml-1 text-blue-500 hover:text-blue-800 dark:hover:text-blue-100 font-semibold"
          >
            ✕
          </button>
        </div>
      )}

      {showCustom && panelOpen && (
        <DateRangePicker
          seasonStart={summary?.season_start}
          initialStart={customRange?.start ?? ''}
          initialEnd={customRange?.end ?? ''}
          onApply={handleApply}
        />
      )}
    </div>
  );
};

export default TimePeriodSelector;
