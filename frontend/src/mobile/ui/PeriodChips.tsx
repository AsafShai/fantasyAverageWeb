import { useEffect, useRef, useState } from 'react'
import { useGetLeagueSummaryQuery } from '../../store/api/fantasyApi'
import DateRangePicker from '../../components/DateRangePicker'
import type { CustomDateRange, TimePeriod } from '../../types/api'
import { Chip, ChipRow } from './Chips'

interface PeriodChipsProps {
  value: TimePeriod
  onChange: (period: TimePeriod) => void
  customRange?: CustomDateRange | null
  onCustomRangeChange?: (range: CustomDateRange | null) => void
  allowCustom?: boolean
  /** Player Rankings ranks a single scored night. */
  showLastNight?: boolean
}

const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * Phone version of TimePeriodSelector: the same periods as a sideways chip
 * row; "Custom" opens today's date-range picker under the row, and an applied
 * range shows as a chip with × to clear it (back to the previous period).
 */
export function PeriodChips({
  value,
  onChange,
  customRange = null,
  onCustomRangeChange,
  allowCustom = true,
  showLastNight = false,
}: PeriodChipsProps) {
  const { data: summary } = useGetLeagueSummaryQuery(undefined, { skip: !allowCustom })
  const [panelOpen, setPanelOpen] = useState(false)
  const prev = useRef<TimePeriod>(value === 'custom' ? 'season' : value)
  useEffect(() => {
    if (value !== 'custom') prev.current = value
  }, [value])

  const periods: { value: TimePeriod; label: string }[] = [
    { value: 'season', label: '📅 Full Season' },
    ...(showLastNight ? [{ value: 'last_night' as const, label: '🌙 Last night' }] : []),
    { value: 'last_7', label: '🔥 Last 7 Days' },
    { value: 'last_15', label: '📊 Last 15 Days' },
    { value: 'last_30', label: '📈 Last 30 Days' },
  ]

  const clear = () => {
    onCustomRangeChange?.(null)
    onChange(prev.current)
    setPanelOpen(false)
  }

  return (
    <>
      <ChipRow label="Period">
        {periods.map((p) => (
          <Chip
            key={p.value}
            selected={value === p.value}
            onClick={() => {
              setPanelOpen(false)
              onChange(p.value)
            }}
          >
            {p.label}
          </Chip>
        ))}
        {allowCustom && (
          <Chip selected={value === 'custom'} aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
            📆 {value === 'custom' && customRange ? `${fmt(customRange.start)} – ${fmt(customRange.end)}` : 'Custom'}
          </Chip>
        )}
        {allowCustom && value === 'custom' && customRange && (
          <Chip removable onClick={clear} aria-label="Clear custom range">
            Clear
          </Chip>
        )}
      </ChipRow>
      {allowCustom && panelOpen && (
        <DateRangePicker
          seasonStart={summary?.season_start}
          initialStart={customRange?.start ?? ''}
          initialEnd={customRange?.end ?? ''}
          onApply={(range) => {
            onCustomRangeChange?.(range)
            onChange('custom')
            setPanelOpen(false)
          }}
        />
      )}
    </>
  )
}
