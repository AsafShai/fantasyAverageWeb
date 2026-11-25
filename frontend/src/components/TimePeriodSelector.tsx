import React, { useEffect, useRef, useState } from 'react';
import { useGetLeagueSummaryQuery } from '../store/api/fantasyApi';
import DateRangePicker from './DateRangePicker';
import type { CustomDateRange, TimePeriod } from '../types/api';

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  customRange?: CustomDateRange | null;
  onCustomRangeChange?: (range: CustomDateRange | null) => void;
  allowCustom?: boolean;
  /** A single scored night, between Full Season and Last 7 Days. */
  showLastNight?: boolean;
  /** Plain: no emoji and no light track. Other pages keep the default chips. */
  appearance?: 'default' | 'plain';
  /** Float the calendar under the Custom button and close it on an outside click. */
  popover?: boolean;
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
  showLastNight = false,
  appearance = 'default',
  popover = false,
}) => {
  const plain = appearance === 'plain';
  const showCustom = allowCustom;
  const { data: summary } = useGetLeagueSummaryQuery(undefined, { skip: !showCustom });
  const [panelOpen, setPanelOpen] = useState(false);
  const prevPeriodRef = useRef<TimePeriod>(value === 'custom' ? 'season' : value);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value !== 'custom') prevPeriodRef.current = value;
  }, [value]);

  useEffect(() => {
    if (!popover || !panelOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setPanelOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popover, panelOpen]);

  const periods: { value: TimePeriod; label: string; shortLabel: string; emoji: string }[] = [
    { value: 'season', label: 'Full Season', shortLabel: 'Season', emoji: '📅' },
    ...(showLastNight
      ? [{ value: 'last_night' as const, label: 'Last night', shortLabel: 'Night', emoji: '🌙' }]
      : []),
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

  const customButton = (
    <button
      type="button"
      onClick={() => setPanelOpen((o) => !o)}
      aria-expanded={panelOpen}
      aria-pressed={plain ? value === 'custom' : undefined}
      className={plain
        ? `pr-period-btn${value === 'custom' ? ' pr-period-on' : ''}`
        : `col-span-2 rounded-md border border-dashed px-3 py-1.5 text-center text-xs font-medium whitespace-nowrap transition-all duration-200 sm:col-span-1 ${
            value === 'custom'
              ? 'bg-white text-blue-600 shadow-sm border-blue-300'
              : 'text-gray-600 hover:text-gray-800 border-gray-400'
          }`}
    >
      <span className={plain ? undefined : 'mr-1'} aria-hidden="true">📆</span>
      Custom
    </button>
  );

  const rangeChip = showCustom && value === 'custom' && customRange && !panelOpen ? (
    <div className={`${popover ? 'absolute left-0 top-full z-40' : ''} mt-2 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-50 dark:bg-blue-900/30 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800`}>
      {formatRangeLabel(customRange)}
      <button
        onClick={handleClearChip}
        aria-label="Clear custom range"
        className="ml-1 text-blue-500 hover:text-blue-800 dark:hover:text-blue-100 font-semibold"
      >
        ✕
      </button>
    </div>
  ) : null;

  const picker = showCustom && panelOpen ? (
    popover ? (
      <div className="absolute left-0 top-full z-40">
        <DateRangePicker
          seasonStart={summary?.season_start}
          initialStart={customRange?.start ?? ''}
          initialEnd={customRange?.end ?? ''}
          onApply={handleApply}
        />
      </div>
    ) : (
      <DateRangePicker
        seasonStart={summary?.season_start}
        initialStart={customRange?.start ?? ''}
        initialEnd={customRange?.end ?? ''}
        onApply={handleApply}
      />
    )
  ) : null;

  return (
    <div className={plain ? 'pr-period-root' : 'mb-0 w-full sm:w-auto'}>
      <div className={plain ? 'pr-period' : 'grid w-full grid-cols-2 gap-1.5 rounded-lg bg-gray-100 p-1 sm:flex sm:w-auto sm:flex-wrap'}>
        {periods.map((period) => (
          <button
            key={period.value}
            type="button"
            onClick={() => onChange(period.value)}
            aria-pressed={plain ? value === period.value : undefined}
            className={plain
              ? `pr-period-btn${value === period.value ? ' pr-period-on' : ''}`
              : `rounded-md px-3 py-1.5 text-center text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                  value === period.value
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
          >
            <span className={plain ? undefined : 'mr-1'} aria-hidden="true">{period.emoji}</span>
            {plain ? period.label : (
              <>
                <span className="sm:hidden">{period.shortLabel}</span>
                <span className="hidden sm:inline">{period.label}</span>
              </>
            )}
          </button>
        ))}
        {showCustom && (
          popover ? (
            <div ref={anchorRef} className="relative">
              {customButton}
              {rangeChip}
              {picker}
            </div>
          ) : customButton
        )}
      </div>

      {!popover && rangeChip}
      {!popover && picker}
    </div>
  );
};

export default TimePeriodSelector;
