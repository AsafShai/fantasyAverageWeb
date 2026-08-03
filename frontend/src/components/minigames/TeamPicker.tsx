import { useEffect, useMemo, useRef, useState } from 'react'
import type { NbaTeamOption } from '../../minigames/types'

export default function TeamPicker({
  teams,
  disabled = false,
  onPick,
}: {
  teams: NbaTeamOption[]
  disabled?: boolean
  onPick: (team: NbaTeamOption) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (t) => t.label.toLowerCase().includes(q) || t.abbr.toLowerCase().includes(q),
    )
  }, [teams, query])

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

  return (
    <div ref={rootRef} className="relative w-full max-w-md">
      <input
        disabled={disabled}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder="Filter by city or abbreviation…"
        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
      />
      {open && !disabled && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg text-sm">
          {results.map((t) => (
            <li key={t.abbr}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-gray-800 flex justify-between gap-2"
                onClick={() => {
                  onPick(t)
                  setQuery('')
                  setOpen(false)
                }}
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">{t.label}</span>
                <span className="text-gray-400">{t.abbr}</span>
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
