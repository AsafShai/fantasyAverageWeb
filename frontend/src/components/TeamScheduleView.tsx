import { Fragment } from 'react'
import { useGetScheduleQuery } from '../store/api/fantasyApi'
import { METRIC_GLOSSARY } from '../constants/metricGlossary'
import InfoTip from './InfoTip'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import type { ScheduleGame } from '../types/api'

interface TeamScheduleViewProps {
  teamId: string
}

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', options).format(new Date(`${date}T12:00:00`))
}

function monthKey(date: string): string {
  return date.slice(0, 7)
}

function monthLabel(date: string): string {
  return formatDate(`${date.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
}

function slateClass(game: ScheduleGame): string {
  if (game.slate_size >= 12) return 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100'
  if (game.high_volume || game.slate_size >= 10) return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
  return 'text-gray-700'
}

function Kpi({ label, value, metric }: { label: string; value: string | number; metric: keyof typeof METRIC_GLOSSARY }) {
  const info = METRIC_GLOSSARY[metric]
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}<InfoTip title={info.title} body={info.body} />
      </div>
      <div className="mt-1 text-xl font-bold text-gray-900">{value}</div>
    </div>
  )
}

export default function TeamScheduleView({ teamId }: TeamScheduleViewProps) {
  const { data, isLoading, error } = useGetScheduleQuery()
  const team = data?.teams.find(item => item.team_id === Number(teamId))

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load team schedule')} />
  if (!team) return <p className="text-sm text-gray-500">Select a team to view its schedule.</p>

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="nba-team-schedule-heading" className="text-xl font-bold text-gray-900">{team.team_name} schedule</h2>
        </div>
        {team.total_games < 82 && (
          <div className="max-w-md rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span className="font-semibold">{team.total_games} games are published.</span> Two Cup knockout slots are held for mid-December and will be added when scheduled.
          </div>
        )}
      </div>

      <div className="mb-5 grid grid-cols-3 gap-2">
        <Kpi label="Total games" value={team.total_games} metric="scheduleTotal" />
        <Kpi label="Back-to-backs" value={team.b2b_count} metric="scheduleB2B" />
        <Kpi label="High-volume" value={team.high_volume_games} metric="scheduleHighVolume" />
      </div>

      <div className="max-h-[34rem] overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-[650px] w-full table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-40 sm:w-1/4" />
            <col className="sm:w-1/4" />
            <col className="w-36 sm:w-1/4" />
            <col className="w-32 sm:w-1/4" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="border-b border-gray-200 px-3 py-3 text-left sm:text-center">Date</th>
              <th className="border-b border-gray-200 px-3 py-3 text-center">Opponent</th>
              <th className="border-b border-gray-200 px-3 py-3 text-right sm:text-center">Rest days</th>
              <th className="border-b border-gray-200 px-3 py-3 text-right sm:text-center">Slate size</th>
            </tr>
          </thead>
          <tbody>
            {team.games.map((game, index) => {
              const previous = team.games[index - 1]
              const showMonth = !previous || monthKey(previous.date) !== monthKey(game.date)
              return (
                <Fragment key={game.game_id}>
                  {showMonth && (
                    <tr className="bg-blue-50/70 dark:bg-gray-700">
                      <th colSpan={4} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-blue-800 dark:text-blue-200">{monthLabel(game.date)}</th>
                    </tr>
                  )}
                  <tr className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-3 text-left text-gray-700 sm:text-center">{formatDate(game.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td className="px-3 py-3 text-center font-medium text-gray-800">
                      <span className="mr-2 text-xs font-bold text-gray-400">{game.is_home ? 'vs' : '@'}</span>{game.opponent}
                    </td>
                    <td className={`px-3 py-3 text-right sm:text-center ${game.rest_days === 0 ? 'font-semibold text-rose-600' : 'text-gray-700'}`}>
                      {game.rest_days === null ? '—' : game.rest_days === 0 ? '0 · B2B' : `${game.rest_days}d`}
                    </td>
                    <td className={`px-3 py-3 text-right sm:text-center font-medium ${slateClass(game)}`}>{game.slate_size}</td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
