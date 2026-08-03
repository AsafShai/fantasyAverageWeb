import { useState } from 'react'

const MAX = 24

export default function NameEntryModal({
  open,
  bestStreak,
  submitting,
  error,
  onSubmit,
  onDismiss,
}: {
  open: boolean
  bestStreak: number
  submitting?: boolean
  error?: string | null
  onSubmit: (name: string) => void
  onDismiss: () => void
}) {
  const [name, setName] = useState('')
  if (!open) return null

  const trimmed = name.trim()
  const valid = trimmed.length >= 1 && trimmed.length <= MAX

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-6 shadow-xl">
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
          You made the top 5!
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Best streak: <span className="font-semibold text-blue-600">{bestStreak}</span>. Enter
          your name for the leaderboard:
        </p>
        <input
          autoFocus
          maxLength={MAX}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !submitting) onSubmit(trimmed)
          }}
          placeholder="Display name"
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-gray-900 dark:text-gray-100 mb-2"
        />
        <p className="text-xs text-gray-400 mb-3">{trimmed.length}/{MAX}</p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300"
          >
            Skip
          </button>
          <button
            type="button"
            disabled={!valid || submitting}
            onClick={() => onSubmit(trimmed)}
            className="px-4 py-1.5 text-sm rounded-md bg-blue-600 text-white font-medium disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
