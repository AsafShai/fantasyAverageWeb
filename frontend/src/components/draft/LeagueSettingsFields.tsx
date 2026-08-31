import {
  LEAGUE_ROUNDS_MAX,
  LEAGUE_ROUNDS_MIN,
  LEAGUE_SIZE_MAX,
  LEAGUE_SIZE_MIN,
  type LeagueBoardSettings,
} from '../../utils/adp'

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{label}</div>
        <div className="text-xs text-gray-400">
          {min}–{max}
        </div>
      </div>
      <div className="inline-flex items-center gap-2">
        <button
          type="button"
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="w-9 h-9 rounded-md border border-gray-300 dark:border-gray-600 text-lg leading-none disabled:opacity-40"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <span className="w-8 text-center text-base font-semibold tabular-nums">{value}</span>
        <button
          type="button"
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="w-9 h-9 rounded-md border border-gray-300 dark:border-gray-600 text-lg leading-none disabled:opacity-40"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  )
}

export default function LeagueSettingsFields({
  value,
  onChange,
}: {
  value: LeagueBoardSettings
  onChange: (next: LeagueBoardSettings) => void
}) {
  return (
    <div className="space-y-5">
      <Stepper
        label="League size"
        value={value.teams}
        min={LEAGUE_SIZE_MIN}
        max={LEAGUE_SIZE_MAX}
        onChange={(teams) => onChange({ ...value, teams })}
      />
      <Stepper
        label="Rounds"
        value={value.rounds}
        min={LEAGUE_ROUNDS_MIN}
        max={LEAGUE_ROUNDS_MAX}
        onChange={(rounds) => onChange({ ...value, rounds })}
      />
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100">Include 3RR</div>
          <div className="text-xs text-gray-400">Rounds 2 and 3 both go last to first</div>
        </div>
        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            type="button"
            onClick={() => onChange({ ...value, threeRr: true })}
            className={`px-3 py-1.5 text-xs font-semibold ${
              value.threeRr ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...value, threeRr: false })}
            className={`px-3 py-1.5 text-xs font-semibold ${
              !value.threeRr ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            No
          </button>
        </div>
      </div>
    </div>
  )
}

export { Stepper }
