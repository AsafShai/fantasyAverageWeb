import { useEffect, useRef, useState } from 'react';
import { useGetLeagueSummaryQuery } from '../../../store/api/fantasyApi';
import DateRangePicker from '../../../components/DateRangePicker';
import { Chip, ChipRow } from '../../../mobile/ui';
import type { CustomDateRange, TimePeriod } from '../../../types/api';
import { formatShort } from '../../../utils/dateRange';

interface PeriodChipsProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  customRange: CustomDateRange | null;
  onCustomRangeChange: (range: CustomDateRange | null) => void;
}

const PERIODS: { value: TimePeriod; label: string }[] = [
  { value: 'season', label: '📅 Full Season' },
  { value: 'last_7', label: '🔥 Last 7 Days' },
  { value: 'last_15', label: '📊 Last 15 Days' },
  { value: 'last_30', label: '📈 Last 30 Days' },
];

/**
 * Phone version of TimePeriodSelector: the same periods plus Custom as one
 * sideways-scrolling chip row. Custom opens the same From/To picker below the
 * row; the applied range shows as a chip that clears back to the last period.
 */
export function PeriodChips({ value, onChange, customRange, onCustomRangeChange }: PeriodChipsProps) {
  const { data: summary } = useGetLeagueSummaryQuery();
  const [panelOpen, setPanelOpen] = useState(false);
  const prev = useRef<TimePeriod>(value === 'custom' ? 'season' : value);
  useEffect(() => {
    if (value !== 'custom') prev.current = value;
  }, [value]);

  return (
    <div className="mr-trade-period">
      <ChipRow label="Period">
        {PERIODS.map((p) => (
          <Chip key={p.value} selected={value === p.value} onClick={() => { onChange(p.value); setPanelOpen(false); }}>
            {p.label}
          </Chip>
        ))}
        <Chip selected={value === 'custom'} aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
          📆 Custom
        </Chip>
      </ChipRow>
      {value === 'custom' && customRange && !panelOpen && (
        <div>
          <Chip
            removable
            aria-label="Clear custom range"
            onClick={() => { onCustomRangeChange(null); onChange(prev.current); }}
          >
            {formatShort(customRange.start)} – {formatShort(customRange.end)}
          </Chip>
        </div>
      )}
      {panelOpen && (
        <DateRangePicker
          seasonStart={summary?.season_start}
          initialStart={customRange?.start ?? ''}
          initialEnd={customRange?.end ?? ''}
          onApply={(range) => { onCustomRangeChange(range); onChange('custom'); setPanelOpen(false); }}
        />
      )}
    </div>
  );
}
