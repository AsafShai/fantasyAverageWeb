import type { RankingStats } from '../../types/api'

interface TopTeamsProps {
  teams: RankingStats[]
}

export default function TopTeams({ teams }: TopTeamsProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow sm:p-6 dark:bg-gray-800">
      <h2 className="pb-3 text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">Top 5 Teams (average)</h2>
      <div className="space-y-2">
        {teams.map((team: RankingStats, index: number) => (
          <div
            key={team.team.team_id}
            className="flex items-center justify-between rounded-lg bg-gray-50 p-2.5 dark:bg-gray-700"
          >
            <div className="flex items-center space-x-3">
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                {index + 1}
              </span>
              <span className="text-xs font-medium text-gray-900 sm:text-sm dark:text-gray-100">
                {team.team.team_name}
              </span>
            </div>
            <div className="text-right">
              <span className="text-sm font-bold tabular-nums text-gray-900 sm:text-base dark:text-gray-50">
                {team.total_points}
              </span>
              <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">pts</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
