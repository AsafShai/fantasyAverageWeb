import { useEffect, useId, useRef, useState } from 'react'
import { Chip, ChipRow } from '../../mobile/ui'
import { filterNbaTeams, NBA_TEAMS, toggleNbaTeam } from './nbaTeams'

interface Props {
  selected: string[]
  onChange: (next: string[]) => void
  /**
   * menu: a button that opens the search, for the desktop filter row.
   * inline: the search and the list sit in the phone filters sheet.
   */
  variant?: 'menu' | 'inline'
}

function teamName(abbr: string): string {
  return NBA_TEAMS.find((team) => team.abbr === abbr)?.name ?? abbr
}

function summary(selected: string[]): string {
  if (selected.length === 0) return 'All teams'
  if (selected.length === 1) return `${selected[0]} · ${teamName(selected[0])}`
  if (selected.length === 2) return selected.join(', ')
  return `${selected.length} teams`
}

function TeamOptions({
  id,
  query,
  selected,
  onToggle,
  className,
  optionClass,
}: {
  id: string
  query: string
  selected: string[]
  onToggle: (abbr: string) => void
  className: string
  optionClass: (on: boolean) => string
}) {
  const teams = filterNbaTeams(query)
  return (
    <div id={id} role="listbox" aria-label="NBA teams" aria-multiselectable="true" className={className}>
      {teams.length === 0 ? (
        <p className="px-3 py-2 text-sm text-gray-400">No teams match</p>
      ) : (
        teams.map((team) => {
          const on = selected.includes(team.abbr)
          return (
            <button
              key={team.abbr}
              type="button"
              role="option"
              aria-selected={on}
              onClick={() => onToggle(team.abbr)}
              className={optionClass(on)}
            >
              <span className="w-9 shrink-0 font-semibold tabular-nums">{team.abbr}</span>
              <span className="min-w-0 truncate">{team.name}</span>
            </button>
          )
        })
      )}
    </div>
  )
}

/** Search the 30 NBA teams by name or abbreviation, then keep only the ones you pick. */
export function NbaTeamFilter({ selected, onChange, variant = 'menu' }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const toggle = (abbr: string) => onChange(toggleNbaTeam(selected, abbr))

  useEffect(() => {
    if (!open || variant !== 'menu') return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, variant])

  const search = (
    <input
      type="search"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Lakers, BOS, sixers…"
      aria-label="Search NBA teams"
      aria-controls={listId}
      className={variant === 'menu' ? 'w-full border-b border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:border-gray-600 dark:text-gray-100' : undefined}
    />
  )

  if (variant === 'inline') {
    return (
      <div className="flex flex-col gap-2">
        {selected.length > 0 && (
          <ChipRow label="Selected NBA teams" wrap>
            {selected.map((abbr) => (
              <Chip key={abbr} removable aria-label={`Remove ${abbr}`} onClick={() => toggle(abbr)}>
                {abbr}
              </Chip>
            ))}
          </ChipRow>
        )}
        <label className="mr-search">{search}</label>
        <TeamOptions
          id={listId}
          query={query}
          selected={selected}
          onToggle={toggle}
          className="mr-pr-teams"
          optionClass={() => 'mr-opt'}
        />
      </div>
    )
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((current) => !current)
          setQuery('')
        }}
        className={`flex min-w-[9.5rem] items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
          selected.length > 0
            ? 'border-blue-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100'
            : 'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{summary(selected)}</span>
        {selected.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear NBA teams"
            className="text-blue-500 hover:text-blue-700"
            onClick={(event) => {
              event.stopPropagation()
              onChange([])
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onChange([])
              }
            }}
          >
            ✕
          </span>
        )}
        <span aria-hidden="true" className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700">
          {search}
          <TeamOptions
            id={listId}
            query={query}
            selected={selected}
            onToggle={toggle}
            className="max-h-60 overflow-y-auto"
            optionClass={(on) =>
              `flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                on
                  ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                  : 'text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-600'
              }`
            }
          />
        </div>
      )}
    </div>
  )
}
