import { useState } from 'react'
import type { CustomDateRange } from '../types/api'
import { validateDateRange, formatShort } from '../utils/dateRange'

const todayIso = () => new Date().toISOString().split('T')[0]

interface DateRangePickerProps {
  seasonStart?: string
  today?: string
  initialStart?: string
  initialEnd?: string
  onApply: (range: CustomDateRange) => void
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({
  seasonStart,
  today = todayIso(),
  initialStart = '',
  initialEnd = '',
  onApply,
}) => {
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)

  const error = validateDateRange(start, end, seasonStart, today)
  const applyDisabled = !start || !end || !!error

  const handleApply = () => {
    if (applyDisabled) return
    onApply({ start, end })
  }

  const handleClear = () => {
    setStart('')
    setEnd('')
  }

  return (
    <div className="mt-2 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-sm w-full min-w-[260px] sm:w-auto sm:inline-block">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex flex-col gap-1 w-full sm:w-auto">
          <label className="text-xs text-gray-600 dark:text-gray-300 font-medium">Start</label>
          <input
            type="date"
            aria-label="Start date"
            value={start}
            min={seasonStart}
            max={end || today}
            onChange={(e) => setStart(e.target.value)}
            className={`w-full sm:w-auto px-3 py-1.5 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border focus:outline-none focus:ring-2 focus:ring-blue-300 ${
              error ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1 w-full sm:w-auto">
          <label className="text-xs text-gray-600 dark:text-gray-300 font-medium">End</label>
          <input
            type="date"
            aria-label="End date"
            value={end}
            min={start || seasonStart}
            max={today}
            onChange={(e) => setEnd(e.target.value)}
            className={`w-full sm:w-auto px-3 py-1.5 rounded-md text-sm bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 border focus:outline-none focus:ring-2 focus:ring-blue-300 ${
              error ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'
            }`}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={applyDisabled}
            className="flex-1 sm:flex-none px-4 py-1.5 text-sm font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
          <button
            onClick={handleClear}
            className="flex-1 sm:flex-none px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-md transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="mt-2 text-[0.7rem] text-gray-500 dark:text-gray-400">
        min = season start{seasonStart ? ` (${seasonStart})` : ''} · max = today · both required
      </p>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">⚠ {error}</p>}
    </div>
  )
}

export default DateRangePicker

interface CoverageNoticeProps {
  requestedStart?: string
  requestedEnd?: string
  actualStart?: string
  actualEnd?: string
}

export function CoverageNotice({ requestedStart, requestedEnd, actualStart, actualEnd }: CoverageNoticeProps) {
  if (!actualStart || !actualEnd) return null
  const startClamped = actualStart !== requestedStart
  const endClamped = actualEnd !== requestedEnd
  if (!startClamped && !endClamped) return null

  let detail: string
  if (startClamped && endClamped) {
    detail = `we only have box scores from ${formatShort(actualStart)} through ${formatShort(actualEnd)}`
  } else if (startClamped) {
    detail = `we only have box scores from ${formatShort(actualStart)} onward`
  } else {
    detail = `we only have box scores through ${formatShort(actualEnd)}`
  }

  return (
    <div className="mb-3 px-4 py-2 bg-amber-50 dark:bg-gray-700 border border-amber-200 dark:border-gray-600 rounded-md text-sm text-amber-700 dark:text-amber-300">
      Showing {formatShort(actualStart)} – {formatShort(actualEnd)} — {detail}.
    </div>
  )
}
