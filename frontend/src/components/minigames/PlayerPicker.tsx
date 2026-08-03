import { useEffect, useMemo, useRef, useState } from 'react'
import type { MinigamePlayer } from '../../minigames/types'

export default function PlayerPicker({
  players,
  excludeIds = [],
  hideHeadshot = false,
  disabled = false,
  onGuess,
}: {
  players: MinigamePlayer[]
  excludeIds?: string[]
  hideHeadshot?: boolean
  disabled?: boolean
  onGuess: (player: MinigamePlayer) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<MinigamePlayer | null>(null)
  const [open, setOpen] = useState(false)
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

  const submitGuess = (player: MinigamePlayer) => {
    onGuess(player)
    setSelected(null)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <div className="flex gap-2">
        <input
          disabled={disabled}
          value={selected ? selected.displayName : query}
          onChange={(e) => {
            setSelected(null)
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search player…"
          className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
        />
        <button
          type="button"
          disabled={disabled || !selected}
          onClick={() => selected && submitGuess(selected)}
          className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium disabled:opacity-40"
        >
          Guess
        </button>
      </div>
      {selected && !hideHeadshot && selected.photoUrl && (
        <img
          src={selected.photoUrl}
          alt=""
          className="mt-2 w-12 h-12 rounded-full object-cover object-top"
        />
      )}
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg text-sm">
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
    </div>
  )
}
