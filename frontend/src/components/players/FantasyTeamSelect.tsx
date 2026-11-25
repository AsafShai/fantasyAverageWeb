import { useEffect, useId, useRef, useState } from 'react'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../myTeam/display'

interface TeamOption {
  team_id: number
  team_name: string
}

interface Props {
  value: number | null
  onChange: (next: number | null) => void
  teams: TeamOption[]
  myTeamId: number | null
  isMyTeam: (teamId: number) => boolean
}

type Option = { key: string; teamId: number | null; label: string }

function labelFor(value: number | null, teams: TeamOption[], isMyTeam: (teamId: number) => boolean): string {
  if (value === null) return 'All Teams'
  if (value === 0) return 'Free Agents / Waivers'
  const team = teams.find((item) => item.team_id === value)
  return team ? fantasyTeamOptionLabel(team.team_name, isMyTeam(team.team_id)) : 'All Teams'
}

function options(teams: TeamOption[], myTeamId: number | null, isMyTeam: (teamId: number) => boolean, query: string): Option[] {
  const all: Option[] = [
    { key: 'all', teamId: null, label: 'All Teams' },
    { key: 'free', teamId: 0, label: 'Free Agents / Waivers' },
    ...leadWithMyTeam(teams, myTeamId).map((team) => ({
      key: `team-${team.team_id}`,
      teamId: team.team_id,
      label: fantasyTeamOptionLabel(team.team_name, isMyTeam(team.team_id)),
    })),
  ]
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((option) => option.label.toLowerCase().includes(q))
}

/** Desktop fantasy-team menu for Players: one team, behind a search. */
export function FantasyTeamSelect({ value, onChange, teams, myTeamId, isMyTeam }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const list = options(teams, myTeamId, isMyTeam, query)
  const selected = value ?? null

  useEffect(() => {
    if (!open) return
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
  }, [open])

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
        className={`flex min-w-[9.5rem] max-w-[16rem] items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
          selected !== null
            ? 'border-blue-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100'
            : 'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{labelFor(selected, teams, isMyTeam)}</span>
        {selected !== null && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear fantasy team"
            className="text-blue-500 hover:text-blue-700"
            onClick={(event) => {
              event.stopPropagation()
              onChange(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onChange(null)
              }
            }}
          >
            ✕
          </span>
        )}
        <span aria-hidden="true" className="text-gray-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-700">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Waivers, team…"
            aria-label="Search fantasy teams"
            aria-controls={listId}
            className="w-full border-b border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:border-gray-600 dark:text-gray-100"
          />
          <div id={listId} role="listbox" aria-label="Fantasy teams" className="max-h-60 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400">No teams match</p>
            ) : (
              list.map((option) => {
                const on = option.teamId === selected
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      onChange(option.teamId)
                      setOpen(false)
                    }}
                    className={`flex w-full items-center px-3 py-1.5 text-left text-sm ${
                      on
                        ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                        : 'text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-gray-600'
                    }`}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
