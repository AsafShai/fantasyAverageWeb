import { useNavigate } from 'react-router'
import type { TeamRosterHealth } from '../../types/api'

interface RosterHealthProps {
  teams: TeamRosterHealth[]
}

function Chip({ value, tone }: { value: number; tone: 'out' | 'questionable' }) {
  if (value === 0) {
    return (
      <span className="inline-block min-w-[1.4rem] rounded bg-gray-100 px-1.5 py-0.5 text-center text-[10px] font-semibold text-gray-400 dark:bg-gray-700 dark:text-gray-500">
        0
      </span>
    )
  }
  const classes =
    tone === 'out'
      ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
  return (
    <span className={`inline-block min-w-[1.4rem] rounded px-1.5 py-0.5 text-center text-[10px] font-semibold ${classes}`}>
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
        <span className="text-[11px] text-gray-400 dark:text-gray-500">tonight</span>
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
                <th scope="col" className="px-1.5 pb-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                  Out
                </th>
                <th scope="col" className="px-1.5 pb-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                  Q
                </th>
                <th scope="col" className="px-1.5 pb-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                  Playing
                </th>
              </tr>
            </thead>
            <tbody>
              {teams.map(team => (
                <tr
                  key={team.team_id}
                  onClick={() => navigate(`/team/${team.team_id}`)}
                  className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                >
                  <td className="max-w-[8rem] truncate px-1.5 py-1.5 text-xs text-gray-900 sm:px-2 sm:text-sm dark:text-gray-100">
                    {team.team_name}
                  </td>
                  <td className="px-1.5 py-1.5 sm:px-2">
                    <Chip value={team.out} tone="out" />
                  </td>
                  <td className="px-1.5 py-1.5 sm:px-2">
                    <Chip value={team.questionable} tone="questionable" />
                  </td>
                  <td className="px-1.5 py-1.5 text-right text-xs tabular-nums text-gray-700 sm:px-2 sm:text-sm dark:text-gray-300">
                    {team.playing_tonight}/{team.playing_tonight + team.out_tonight}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
