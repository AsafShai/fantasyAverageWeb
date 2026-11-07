import { useRef } from 'react'
import { useGetLeagueSummaryQuery } from '../../store/api/fantasyApi'
import DateRangePicker from '../../components/DateRangePicker'
import type { CustomDateRange, TimePeriod } from '../../types/api'
import { timePeriodLabel } from '../../hooks/usePlayerProfileData'
import { BottomSheet, Chip, ChipRow, useSheetHistory } from '../ui'

const PERIODS: { value: TimePeriod; label: string; emoji: string }[] = [
  { value: 'season', label: 'Full Season', emoji: '📅' },
  { value: 'last_7', label: 'Last 7 Days', emoji: '🔥' },
  { value: 'last_15', label: 'Last 15 Days', emoji: '📊' },
  { value: 'last_30', label: 'Last 30 Days', emoji: '📈' },
]

interface Props {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
  customRange: CustomDateRange | null
  onCustomRangeChange: (range: CustomDateRange | null) => void
}

/**
 * The profile's time frame as a chip row: the same periods as the desktop
 * selector, plus Custom, whose From/To picker opens in a bottom sheet
 * (browser back closes it). A custom range shows on its chip with a clear ×.
 */
export default function TimeFrameChips({ value, onChange, customRange, onCustomRangeChange }: Props) {
  const sheet = useSheetHistory('profile-range')
  const { data: summary } = useGetLeagueSummaryQuery(undefined, { skip: !sheet.open })
  // where Clear goes back to, as on desktop
  const prev = useRef<TimePeriod>('season')
  const pick = (p: TimePeriod) => {
    prev.current = p
    onChange(p)
  }
  const isCustom = value === 'custom' && !!customRange

  return (
    <div className="mr-pp-frame">
      <span className="mr-meta">Time frame · Fantasy Value, Stats and Trends</span>
      <ChipRow label="Time frame">
        {PERIODS.map((p) => (
          <Chip key={p.value} selected={value === p.value} onClick={() => pick(p.value)}>
            <span aria-hidden="true">{p.emoji}</span>
            {p.label}
          </Chip>
        ))}
        <Chip selected={isCustom} onClick={sheet.show} aria-haspopup="dialog">
          <span aria-hidden="true">📆</span>
          {isCustom ? timePeriodLabel('custom', customRange) : 'Custom'}
        </Chip>
        {isCustom && (
          <Chip
            aria-label="Clear custom range"
            onClick={() => {
              onCustomRangeChange(null)
              onChange(prev.current)
            }}
          >
            ✕
          </Chip>
        )}
      </ChipRow>

      <BottomSheet open={sheet.open} onClose={sheet.hide} title="Custom range">
        <DateRangePicker
          seasonStart={summary?.season_start}
          initialStart={customRange?.start ?? ''}
          initialEnd={customRange?.end ?? ''}
          onApply={(range) => {
            onCustomRangeChange(range)
            onChange('custom')
            sheet.hide()
          }}
        />
      </BottomSheet>
    </div>
  )
}
