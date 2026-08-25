import { useEffect, useState } from 'react'
import {
  LEAGUE_ROUNDS_MAX,
  LEAGUE_ROUNDS_MIN,
  LEAGUE_SIZE_MAX,
  LEAGUE_SIZE_MIN,
  clampLeagueSettings,
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

export default function LeagueSettingsModal({
  settings,
  onConfirm,
  onClose,
}: {
  settings: LeagueBoardSettings
  onConfirm: (next: LeagueBoardSettings) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => clampLeagueSettings(settings))

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="league-settings-title"
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="league-settings-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">
          League settings
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          These change how the draft board is laid out. Picks stay sorted by Blend ADP.
        </p>
        <div className="mt-5 space-y-5">
          <Stepper
            label="League size"
            value={draft.teams}
            min={LEAGUE_SIZE_MIN}
            max={LEAGUE_SIZE_MAX}
            onChange={(teams) => setDraft((prev) => ({ ...prev, teams }))}
          />
          <Stepper
            label="Rounds"
            value={draft.rounds}
            min={LEAGUE_ROUNDS_MIN}
            max={LEAGUE_ROUNDS_MAX}
            onChange={(rounds) => setDraft((prev) => ({ ...prev, rounds }))}
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">Include 3RR</div>
              <div className="text-xs text-gray-400">Rounds 2 and 3 both go last to first</div>
            </div>
            <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, threeRr: true }))}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  draft.threeRr ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, threeRr: false }))}
                className={`px-3 py-1.5 text-xs font-semibold ${
                  !draft.threeRr ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300'
                }`}
              >
                No
              </button>
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(clampLeagueSettings(draft))}
            className="btn-primary text-sm py-2 px-4"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
