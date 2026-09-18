import { useNavigate } from 'react-router'
import { useSort } from '../../hooks/useSort'
import SortableHeaderCell from './SortableHeaderCell'
import type { TeamRosterHealth } from '../../types/api'

interface RosterHealthProps {
  slateDate: string | null
  gamesCount: number
  teams: TeamRosterHealth[]
}

type StatusKey = 'available_tonight' | 'probable' | 'questionable' | 'doubtful' | 'out'

type Column = {
  key: StatusKey
  short: string
  full: string
  tone: string
}

const COLUMNS: Column[] = [
  { key: 'available_tonight', short: 'AVAILABLE', full: 'Available', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { key: 'probable', short: 'P', full: 'Probable', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  { key: 'questionable', short: 'Q', full: 'Questionable', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  { key: 'doubtful', short: 'D', full: 'Doubtful', tone: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  { key: 'out', short: 'OUT', full: 'Out', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
]

const ZERO_TONE = 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'

type SortKey = 'team' | 'games_tonight' | StatusKey

const COMPARATORS: Record<SortKey, (a: TeamRosterHealth, b: TeamRosterHealth) => number> = {
  team: (a, b) => a.team_name.localeCompare(b.team_name),
  games_tonight: (a, b) => a.games_tonight - b.games_tonight,
  available_tonight: (a, b) => a.available_tonight - b.available_tonight,
  probable: (a, b) => a.probable - b.probable,
  questionable: (a, b) => a.questionable - b.questionable,
  doubtful: (a, b) => a.doubtful - b.doubtful,
  out: (a, b) => a.out - b.out,
}

function Chip({ value, tone }: { value: number; tone: string }) {
  return (
    <span
      className={`inline-block min-w-[1.1rem] rounded px-0.5 py-0.5 text-center text-[10px] font-semibold sm:min-w-[1.5rem] sm:px-1.5 ${
        value === 0 ? ZERO_TONE : tone
      }`}
    >
      {value}
    </span>
  )
}

function Tile({ value, label, warn = false }: { value: number; label: string; warn?: boolean }) {
  return (
    <div
      className={`rounded-r bg-gray-50 px-2 py-1.5 dark:bg-gray-700 ${
        warn ? 'border-l-[3px] border-amber-500' : 'border-l-[3px] border-blue-500'
      }`}
    >
      <b className="block text-lg font-bold leading-none tabular-nums text-gray-900 dark:text-gray-50">{value}</b>
      <span className="text-[9.5px] text-gray-500 dark:text-gray-400">{label}</span>
    </div>
  )
}

export default function RosterHealth({ slateDate, gamesCount, teams }: RosterHealthProps) {
  const navigate = useNavigate()
  const { sorted, sortKey, direction, toggle } = useSort<TeamRosterHealth, SortKey>(teams, COMPARATORS)

  const availableTotal = teams.reduce((sum, team) => sum + team.available_tonight, 0)
  const outTotal = teams.reduce((sum, team) => sum + team.out, 0)

  return (
    <div className="flex flex-col rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <h2 className="pb-2 text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Roster health today</h2>

      {gamesCount === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">No NBA games scheduled.</p>
      ) : (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile value={gamesCount} label="NBA games" />
          <Tile value={gamesCount * 2} label="teams playing" />
          <Tile value={availableTotal} label="available" />
          <Tile value={outTotal} label="Out tonight" warn />
        </div>
      )}

      {teams.length === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">
          Injury report unavailable — rosters will show once the league is set.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600">
                <SortableHeaderCell
                  label="Team"
                  active={sortKey === 'team'}
                  direction={direction}
                  onSort={() => toggle('team')}
                  className="sticky left-0 z-20 bg-white dark:bg-gray-800"
                />
                <SortableHeaderCell
                  label="GAMES"
                  active={sortKey === 'games_tonight'}
                  direction={direction}
                  align="right"
                  onSort={() => toggle('games_tonight')}
                />
                {COLUMNS.map(column => (
                  <th
                    key={column.key}
                    scope="col"
                    title={column.full}
                    aria-sort={sortKey === column.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="whitespace-nowrap px-0.5 pb-1.5 text-center text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-1.5 dark:text-gray-500"
                  >
                    <button
                      type="button"
                      onClick={() => toggle(column.key)}
                      className={`inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 ${
                        sortKey === column.key ? 'text-gray-700 dark:text-gray-200' : ''
                      }`}
                    >
                      <span className="sr-only">{column.full}</span>
                      <span aria-hidden="true" className="sm:hidden">
                        {column.short}
                      </span>
                      <span aria-hidden="true" className="hidden normal-case sm:inline">
                        {column.full}
                      </span>
                      <span className="text-[8px] leading-none">
                        {sortKey === column.key ? (direction === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(team => (
                <tr
                  key={team.team_id}
                  onClick={() => navigate(`/team/${team.team_id}`)}
                  className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  <td className="sticky left-0 z-10 max-w-[6rem] truncate bg-white px-1.5 py-1.5 text-xs text-gray-900 sm:max-w-[8rem] sm:px-2 sm:text-sm dark:bg-gray-800 dark:text-gray-100">
                    {team.team_name}
                  </td>
                  <td className="px-0.5 py-1.5 text-right text-xs font-bold tabular-nums text-gray-900 sm:px-2 sm:text-sm dark:text-gray-50">
                    {team.games_tonight}
                  </td>
                  {COLUMNS.map(column => (
                    <td key={column.key} className="px-0.5 py-1.5 text-center sm:px-1.5">
                      <Chip value={team[column.key]} tone={column.tone} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {slateDate && (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">Slate {slateDate}</p>
      )}
    </div>
  )
}
