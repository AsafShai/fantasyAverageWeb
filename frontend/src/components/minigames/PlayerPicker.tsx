import { useEffect, useMemo, useRef, useState } from 'react'
import type { MinigamePlayer } from '../../minigames/types'

export default function PlayerPicker({
  players,
  excludeIds = [],
  hideHeadshot = false,
  disabled = false,
  confirmBeforeSubmit = false,
  onGuess,
}: {
  players: MinigamePlayer[]
  excludeIds?: string[]
  hideHeadshot?: boolean
  disabled?: boolean
  /** Ask once before committing (Now You See Me — avoids mis-taps). */
  confirmBeforeSubmit?: boolean
  onGuess: (player: MinigamePlayer) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<MinigamePlayer | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState<MinigamePlayer | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const excluded = useMemo(() => new Set(excludeIds), [excludeIds])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...players]
      .filter((p) => !excluded.has(p.id))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'en'))
    if (!q) return sorted.slice(0, 100)
    return sorted
      .filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q) ||
          p.teamAbbr.toLowerCase().includes(q),
      )
      .slice(0, 100)
  }, [players, query, excluded])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  const commitGuess = (player: MinigamePlayer) => {
    onGuess(player)
    setSelected(null)
    setQuery('')
    setOpen(false)
    setConfirming(null)
  }

  const trySubmitFromInput = () => {
    if (disabled) return
    if (selected) {
      if (confirmBeforeSubmit) setConfirming(selected)
      else commitGuess(selected)
      return
    }
    const q = query.trim().toLowerCase()
    if (!q) return
    const exact = results.find((p) => p.displayName.toLowerCase() === q)
    const pick = exact ?? (results.length === 1 ? results[0] : null)
    if (pick) {
      if (confirmBeforeSubmit) setConfirming(pick)
      else commitGuess(pick)
    }
  }

  return (
    <div ref={rootRef} className={`relative w-full max-w-md ${open ? 'z-30' : 'z-0'}`}>
      <div className="flex min-w-0 items-center gap-2">
        <input
          disabled={disabled}
          value={selected ? selected.displayName : query}
          onChange={(e) => {
            setSelected(null)
            setConfirming(null)
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              trySubmitFromInput()
            }
          }}
          placeholder="Search player…"
          className="min-w-0 flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
        />
        {selected && !hideHeadshot && selected.photoUrl ? (
          <img
            src={selected.photoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-full object-cover object-top"
          />
        ) : null}
        <button
          type="button"
          disabled={disabled || (!selected && !query.trim())}
          onClick={trySubmitFromInput}
          className="shrink-0 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-40"
        >
          Guess
        </button>
      </div>
      {open && !disabled && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl text-sm isolate">
          {results.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-gray-800 flex justify-between gap-2"
                onClick={() => {
                  setSelected(p)
                  setQuery(p.displayName)
                  setOpen(false)
                }}
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">{p.displayName}</span>
                <span className="text-gray-400">{p.teamAbbr}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3 py-2 text-gray-400">No matches</li>
          )}
        </ul>
      )}
      {confirming && (
        <div
          className="mt-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 p-3 text-sm"
          role="dialog"
          aria-label="Confirm guess"
        >
          <p className="mb-2 text-gray-800 dark:text-gray-100">
            Lock in <strong>{confirming.displayName}</strong>? A wrong name ends your streak.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => commitGuess(confirming)}
              className="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium"
            >
              Yes, submit
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
