import type { WeekScheduleDay } from '../utils/slateWindow'
import './MatchupDisplay.css'

export type PlayerTableMode = 'stats' | 'schedule'

export const SCHEDULE_HORIZONS = [7, 14, 28] as const
export type ScheduleHorizon = (typeof SCHEDULE_HORIZONS)[number]

export function ScheduleHorizonToggle({
  value,
  onChange,
}: {
  value: ScheduleHorizon
  onChange: (value: ScheduleHorizon) => void
}) {
  return (
    <div className="flex w-full overflow-hidden rounded border border-gray-300 sm:w-auto dark:border-gray-600">
      {SCHEDULE_HORIZONS.map((days, index) => (
        <button
          key={days}
          type="button"
          className={`flex-1 px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 sm:flex-none ${
            index > 0 ? 'border-l border-gray-300 dark:border-gray-600' : ''
          } ${
            value === days
              ? 'bg-blue-600 font-medium text-white'
              : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
          onClick={() => onChange(days)}
        >
          {days} days
        </button>
      ))}
    </div>
  )
}

export function StatsScheduleToggle({
  mode,
  onChange,
}: {
  mode: PlayerTableMode
  onChange: (mode: PlayerTableMode) => void
}) {
  return (
    <div className="flex w-full self-start overflow-hidden rounded border border-gray-300 sm:w-auto dark:border-gray-600">
      <button
        type="button"
        className={`flex-1 sm:flex-none px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 border-r border-gray-300 dark:border-gray-600 ${
          mode === 'stats'
            ? 'bg-blue-600 text-white font-medium'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        onClick={() => onChange('stats')}
      >
        Stats
      </button>
      <button
        type="button"
        className={`flex-1 sm:flex-none px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ${
          mode === 'schedule'
            ? 'bg-blue-600 text-white font-medium'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
        }`}
        onClick={() => onChange('schedule')}
      >
        Schedule
      </button>
    </div>
  )
}

export function WeekDayHeading({ day }: { day: WeekScheduleDay }) {
  return (
    <span className="flex flex-col items-center leading-tight normal-case">
      <span>{day.weekday}</span>
      <span className="font-normal">{day.label}</span>
    </span>
  )
}

export function WeekOpponent({ opponent }: { opponent: string | undefined }) {
  if (!opponent) return null
  return <span className="mq-opp">vs {opponent}</span>
}
