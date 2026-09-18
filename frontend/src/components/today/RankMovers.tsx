import { useNavigate } from 'react-router'
import type { RankMover } from '../../types/api'

interface RankMoversProps {
  movers: RankMover[]
}

function formatDelta(delta: number): string {
  const rounded = Math.abs(delta) % 1 === 0 ? Math.abs(delta).toFixed(0) : Math.abs(delta).toFixed(1)
  return `${delta > 0 ? '▲' : '▼'} ${rounded}`
}

export default function RankMovers({ movers }: RankMoversProps) {
  const navigate = useNavigate()

  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Rank movers</h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">vs yesterday</span>
      </div>

      {movers.length === 0 ? (
        <p className="py-3 text-xs text-gray-500 dark:text-gray-400">
          Movers appear after the second scoring period.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-600">
                  <th scope="col" className="px-1.5 pb-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                    Team
                  </th>
                  <th scope="col" className="px-1.5 pb-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                    Cat
                  </th>
                  <th scope="col" className="px-1.5 pb-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider text-gray-400 sm:px-2 dark:text-gray-500">
                    Δ
                  </th>
                </tr>
              </thead>
              <tbody>
                {movers.map(mover => (
                  <tr
                    key={`${mover.team_id}-${mover.category}`}
                    onClick={() => navigate(`/team/${mover.team_id}`)}
                    className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                  >
                    <td className="max-w-[8rem] truncate px-1.5 py-1.5 text-xs text-gray-900 sm:max-w-[11rem] sm:px-3 sm:text-sm dark:text-gray-100">
                      {mover.team_name}
                    </td>
                    <td className="px-1.5 py-1.5 sm:px-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          mover.category === 'TOTAL'
                            ? 'bg-gray-800 text-gray-50 dark:bg-gray-200 dark:text-gray-900'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        }`}
                      >
                        {mover.category}
                      </span>
                    </td>
                    <td
                      className={`px-1.5 py-1.5 text-right text-xs font-bold tabular-nums sm:px-2 sm:text-sm ${
                        mover.delta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {formatDelta(mover.delta)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
