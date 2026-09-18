import { useNavigate } from 'react-router'
import type { TeamRosterHealth } from '../../types/api'

interface RosterHealthProps {
  teams: TeamRosterHealth[]
}

type Column = {
  key: keyof Pick<TeamRosterHealth, 'available_tonight' | 'probable' | 'questionable' | 'doubtful' | 'out'>
  short: string
  full: string
  tone: string
}

const COLUMNS: Column[] = [
  { key: 'available_tonight', short: 'AVL', full: 'Avail', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  { key: 'probable', short: 'PRB', full: 'Prob', tone: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300' },
  { key: 'questionable', short: 'QST', full: 'Ques', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  { key: 'doubtful', short: 'DBT', full: 'Doubt', tone: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  { key: 'out', short: 'OUT', full: 'Out', tone: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' },
]

const ZERO_TONE = 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'

function Chip({ value, tone }: { value: number; tone: string }) {
  return (
    <span
      className={`inline-block min-w-[1.3rem] rounded px-1 py-0.5 text-center text-[10px] font-semibold sm:min-w-[1.5rem] sm:px-1.5 ${
        value === 0 ? ZERO_TONE : tone
      }`}
    >
      {value}
    </span>
  )
}

export default function RosterHealth({ teams }: RosterHealthProps) {
  const navigate = useNavigate()

  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Roster health</h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">players with a game tonight</span>
      </div>

      {teams.length === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">
          Injury report unavailable — rosters will show once the league is set.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-600">
                <th scope="col" className="px-1.5 pb-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                  Team
                </th>
                {COLUMNS.map(column => (
                  <th
                    key={column.key}
                    scope="col"
                    className="px-1 pb-1.5 text-center text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-1.5 dark:text-gray-500"
                  >
                    <span className="sm:hidden">{column.short}</span>
                    <span className="hidden sm:inline">{column.full}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map(team => (
                <tr
                  key={team.team_id}
                  onClick={() => navigate(`/team/${team.team_id}`)}
                  className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  <td className="max-w-[6.5rem] truncate px-1.5 py-1.5 text-xs text-gray-900 sm:max-w-[8rem] sm:px-2 sm:text-sm dark:text-gray-100">
                    {team.team_name}
                  </td>
                  {COLUMNS.map(column => (
                    <td key={column.key} className="px-1 py-1.5 text-center sm:px-1.5">
                      <Chip value={team[column.key]} tone={column.tone} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
