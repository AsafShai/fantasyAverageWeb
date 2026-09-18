import type { TeamRosterHealth } from '../../types/api'

interface TonightStripProps {
  slateDate: string | null
  gamesCount: number
  teams: TeamRosterHealth[]
}

const ACTIVE_SLOTS = 10

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

export default function TonightStrip({ slateDate, gamesCount, teams }: TonightStripProps) {
  const availableTotal = teams.reduce((sum, team) => sum + team.available_tonight, 0)
  const outTotal = teams.reduce((sum, team) => sum + team.out, 0)
  const ordered = [...teams].sort((a, b) => b.available_tonight - a.available_tonight)

  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Tonight</h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">games per fantasy team</span>
      </div>

      {gamesCount === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">No NBA games scheduled.</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile value={gamesCount} label="NBA games" />
            <Tile value={gamesCount * 2} label="teams playing" />
            <Tile value={availableTotal} label="available" />
            <Tile value={outTotal} label="Out tonight" warn />
          </div>

          {ordered.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No rostered players on tonight's slate.
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
                      Slots
                    </th>
                    <th scope="col" className="px-1.5 pb-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                      Available
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(team => (
                    <tr key={team.team_id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                      <td className="max-w-[7rem] truncate px-1.5 py-1.5 text-xs text-gray-900 sm:max-w-[9rem] sm:px-3 sm:text-sm dark:text-gray-100">
                        {team.team_name}
                      </td>
                      <td className="px-1.5 py-1.5 sm:px-2">
                        <span className="block h-1.5 min-w-[3rem] overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                          <span
                            className="block h-full rounded bg-blue-400 dark:bg-blue-600"
                            style={{ width: `${Math.min(100, (team.available_tonight / ACTIVE_SLOTS) * 100)}%` }}
                          />
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5 text-right text-xs tabular-nums text-gray-700 sm:px-2 sm:text-sm dark:text-gray-300">
                        {team.available_tonight}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {slateDate && (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">Slate {slateDate}</p>
      )}
    </div>
  )
}
