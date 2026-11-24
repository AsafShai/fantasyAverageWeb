import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { NbaTeamInfo } from '../types/api'
import { nbaTeamLogoUrl } from '../utils/nbaImages'

/** Team logo that hides itself if ESPN has no file for the code. */
export function NbaTeamLogo({ abbr, size = 24 }: { abbr: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span aria-hidden="true" className="shrink-0" style={{ width: size, height: size }} />
  return (
    <img
      src={nbaTeamLogoUrl(abbr, 64)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
    />
  )
}

/**
 * NBA team picker with logos (a native <select> can't show images). A button
 * opens a listbox; arrows, Home/End, a letter, Enter and Escape work as in a select.
 */
export default function NbaTeamSelect({ teams, value, onChange, placeholder = 'Select a team...' }: {
  teams: NbaTeamInfo[]
  value: string
  onChange: (teamId: string) => void
  placeholder?: string
}) {
  const sorted = useMemo(() => [...teams].sort((a, b) => a.team_name.localeCompare(b.team_name)), [teams])
  const selected = sorted.find(team => team.team_id === value)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const optionId = (index: number) => `${listId}-opt-${index}`

  const show = () => {
    setActive(Math.max(0, sorted.findIndex(team => team.team_id === value)))
    setOpen(true)
  }
  const close = (refocus = true) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }
  const pick = (index: number) => {
    const team = sorted[index]
    if (team) onChange(team.team_id)
    close()
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  useEffect(() => {
    if (!open) return
    document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
    // optionId only depends on listId, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const last = sorted.length - 1
    if (event.key === 'ArrowDown') setActive(i => Math.min(i + 1, last))
    else if (event.key === 'ArrowUp') setActive(i => Math.max(i - 1, 0))
    else if (event.key === 'Home') setActive(0)
    else if (event.key === 'End') setActive(last)
    else if (event.key === 'Enter' || event.key === ' ') pick(active)
    else if (event.key === 'Escape') close()
    else if (event.key === 'Tab') { setOpen(false); return }
    else if (/^[a-z]$/i.test(event.key)) {
      const letter = event.key.toLowerCase()
      const from = sorted.findIndex((team, i) => i > active && team.team_name.toLowerCase().startsWith(letter))
      const next = from >= 0 ? from : sorted.findIndex(team => team.team_name.toLowerCase().startsWith(letter))
      if (next >= 0) setActive(next)
    } else return
    event.preventDefault()
  }

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      show()
    }
  }

  return (
    <div ref={rootRef} className="relative w-full sm:w-72">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`NBA team: ${selected?.team_name ?? 'none selected'}`}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onButtonKey}
        className="flex min-h-10 w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-left text-sm text-gray-800 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
      >
        {selected && <NbaTeamLogo key={selected.abbreviation} abbr={selected.abbreviation} />}
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-gray-500 dark:text-gray-400'}`}>{selected?.team_name ?? placeholder}</span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="NBA teams"
          tabIndex={-1}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKey}
          onBlur={event => {
            if (!rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false)
          }}
          className="absolute left-0 top-full z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg focus:outline-none dark:border-gray-600 dark:bg-gray-800"
        >
          {sorted.map((team, index) => {
            const isSelected = team.team_id === value
            return (
              <li
                key={team.team_id}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(index)}
                onMouseDown={event => event.preventDefault()}
                onClick={() => pick(index)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ${index === active ? 'bg-blue-50 dark:bg-blue-900/40' : ''} ${isSelected ? 'font-semibold text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-100'}`}
              >
                <NbaTeamLogo abbr={team.abbreviation} />
                <span className="min-w-0 flex-1 truncate">{team.team_name}</span>
                <span className="shrink-0 text-xs font-medium text-gray-400">{team.abbreviation}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
