import { useEffect, useState } from 'react'
import { clampLeagueSettings, type LeagueBoardSettings } from '../../utils/adp'
import LeagueSettingsFields from './LeagueSettingsFields'

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
        <div className="mt-5">
          <LeagueSettingsFields value={draft} onChange={setDraft} />
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
