import { useEffect, useId, useRef, useState } from 'react'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../myTeam/display'
import type { Team } from '../../types/api'
import {
  fantasyFilterLabel,
  fantasyTeamChipSelected,
  fantasyTeamPresetSelected,
  setFantasyTeamPreset,
  toggleFantasyTeamSelection,
  type FantasyTeamFilter,
} from '../../mobile/pages/playerRankings/filters'

interface Props {
  value: FantasyTeamFilter
  onChange: (next: FantasyTeamFilter) => void
  teams: Team[]
  myTeamId: number | null
  isMyTeam: (teamId: number) => boolean
}

type Preset = null | 'rostered' | 0

type Option =
  | { key: string; kind: 'preset'; preset: Preset; label: string }
  | { key: string; kind: 'team'; teamId: number; label: string }

const PRESETS: { preset: Preset; label: string }[] = [
  { preset: null, label: 'All' },
  { preset: 'rostered', label: 'Rostered' },
  { preset: 0, label: 'Free Agents / Waivers' },
]

function options(teams: Team[], myTeamId: number | null, isMyTeam: (teamId: number) => boolean, query: string): Option[] {
  const all: Option[] = [
    ...PRESETS.map((preset) => ({ key: `preset-${String(preset.preset)}`, kind: 'preset' as const, preset: preset.preset, label: preset.label })),
    ...leadWithMyTeam(teams, myTeamId).map((team) => ({
      key: `team-${team.team_id}`,
      kind: 'team' as const,
      teamId: team.team_id,
      label: fantasyTeamOptionLabel(team.team_name, isMyTeam(team.team_id)),
    })),
  ]
  const q = query.trim().toLowerCase()
  if (!q) return all
  return all.filter((option) => option.label.toLowerCase().includes(q))
}

function isSelected(option: Option, value: FantasyTeamFilter): boolean {
  if (option.kind === 'preset') return fantasyTeamPresetSelected(value, option.preset)
  return fantasyTeamChipSelected(value, option.teamId)
}

/** Desktop fantasy-team menu: the same choices as the chips, behind a search. */
export function FantasyTeamMenu({ value, onChange, teams, myTeamId, isMyTeam }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const list = options(teams, myTeamId, isMyTeam, query)

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

  const pick = (option: Option) => {
    if (option.kind === 'preset') onChange(setFantasyTeamPreset(value, option.preset))
    else onChange(toggleFantasyTeamSelection(value, option.teamId))
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
        className={`flex min-w-[9.5rem] max-w-[16rem] items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
          value !== null
            ? 'border-blue-500 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100'
            : 'border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{fantasyFilterLabel(value, teams)}</span>
        {value !== null && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear fantasy teams"
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
            placeholder="Rostered, waivers, team…"
            aria-label="Search fantasy teams"
            aria-controls={listId}
            className="w-full border-b border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 dark:border-gray-600 dark:text-gray-100"
          />
          <div id={listId} role="listbox" aria-label="Fantasy teams" aria-multiselectable="true" className="max-h-60 overflow-y-auto">
            {list.length === 0 ? (
              <p className="px-3 py-2 text-sm text-gray-400">No teams match</p>
            ) : (
              list.map((option) => {
                const on = isSelected(option, value)
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => pick(option)}
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
