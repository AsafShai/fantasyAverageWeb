import { useMemo, useState } from 'react'
import InfoTip from '../components/InfoTip'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import SlateCalendar from '../components/SlateCalendar'
import { useGetScheduleQuery } from '../store/api/fantasyApi'
import { METRIC_GLOSSARY } from '../constants/metricGlossary'
import { getErrorMessage } from '../utils/errorMessage'
import { formatSlateDate, weekStart } from '../utils/slateWindow'

const MONTHS = ['October', 'November', 'December', 'January', 'February', 'March', 'April']

type Grain = 'months' | 'weeks'

function heatClass(value: number, min: number, max: number): string {
  if (value === 0) return 'bg-gray-50 text-gray-400'
  if (max === min || value === max) return 'bg-blue-200 text-blue-950'
  const ratio = (value - min) / (max - min)
  if (ratio >= 0.75) return 'bg-blue-100 text-blue-900'
  if (ratio >= 0.35) return 'bg-blue-50 text-blue-800'
  return 'bg-white text-gray-700'
}

function MetricHeader({ label, metric }: { label: string; metric: keyof typeof METRIC_GLOSSARY }) {
  const info = METRIC_GLOSSARY[metric]
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <InfoTip title={info.title} body={info.body} formula={'formula' in info ? info.formula : undefined} />
    </span>
  )
}

export default function Schedule() {
  const { data, isLoading, error } = useGetScheduleQuery()
  const [grain, setGrain] = useState<Grain>('months')

  const weeks = useMemo(() => {
    const starts = new Set<string>()
    for (const day of data?.calendar_days ?? []) {
      if (day.slate_size > 0) starts.add(weekStart(day.date))
    }
    return [...starts].sort()
  }, [data])

  const weeklyGames = useMemo(() => {
    const byTeam = new Map<number, Record<string, number>>()
    for (const team of data?.teams ?? []) {
      const counts: Record<string, number> = {}
      for (const game of team.games) {
        const key = weekStart(game.date)
        counts[key] = (counts[key] ?? 0) + 1
      }
      byTeam.set(team.team_id, counts)
    }
    return byTeam
  }, [data])

  const columns = grain === 'months' ? MONTHS : weeks
  const cellValues = useMemo(() => {
    if (!data) return []
    return data.teams.flatMap(team =>
      grain === 'months'
        ? MONTHS.map(month => team.monthly_games[month] ?? 0)
        : weeks.map(week => weeklyGames.get(team.team_id)?.[week] ?? 0)
    )
  }, [data, grain, weeklyGames, weeks])

  const minCell = cellValues.length ? Math.min(...cellValues) : 0
  const maxCell = cellValues.length ? Math.max(...cellValues) : 0

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load NBA schedule')} />
  if (!data) return null

  const scheduleGap = data.published_games_min > 0 && data.published_games_min < 82

  return (
    <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Season schedule</h1>
        <p className="mt-2 max-w-3xl text-gray-600">A full-season NBA schedule through a fantasy lens: density, rest, back-to-backs, and where each team’s games land by month.</p>
      </div>

      {scheduleGap && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <span className="font-semibold">{data.published_games_min} games are published per team right now.</span>{' '}
          Two slots are held for the NBA Cup knockout round and are filled around mid-December; this is expected, not missing data.
        </div>
      )}

      <SlateCalendar schedule={data} />

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="font-medium text-gray-700">Season {data.season}</span>
        <span>·</span>
        <span>Blue cells show relative {grain === 'months' ? 'month' : 'week'} density.</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-100" /> higher count</span>
        <div className="ml-auto flex rounded-lg border border-gray-200 p-1">
          {(['months', 'weeks'] as const).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setGrain(value)}
              className={`rounded-md px-3 py-1.5 capitalize ${grain === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 bg-white shadow">
        <table className={`${grain === 'months' ? 'min-w-[980px]' : 'min-w-[1500px]'} w-full border-collapse text-sm`}>
          <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="sticky left-0 z-30 border-b border-gray-200 bg-gray-50 px-3 py-3 text-left">Team</th>
              {columns.map(column => (
                <th key={column} className="border-b border-gray-200 px-3 py-3 text-right whitespace-nowrap">
                  {grain === 'months' ? column : formatSlateDate(column, { month: 'short', day: 'numeric' })}
                </th>
              ))}
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="Total" metric="scheduleTotal" /></th>
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="B2B" metric="scheduleB2B" /></th>
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="High volume" metric="scheduleHighVolume" /></th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map(team => (
              <tr key={team.team_id} className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40">
                <th className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-100 bg-white px-3 py-3 text-left font-semibold text-gray-800">
                  {team.team_name}
                </th>
                {columns.map(column => {
                  const value = grain === 'months'
                    ? team.monthly_games[column] ?? 0
                    : weeklyGames.get(team.team_id)?.[column] ?? 0
                  return <td key={column} className={`px-3 py-3 text-right font-medium ${heatClass(value, minCell, maxCell)}`}>{value}</td>
                })}
                <td className="px-3 py-3 text-right font-semibold text-gray-800">{team.total_games}</td>
                <td className="px-3 py-3 text-right text-gray-700">{team.b2b_count}</td>
                <td className="px-3 py-3 text-right text-gray-700">{team.high_volume_games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {grain === 'weeks' && 'Weeks start Monday. '}
        High-volume means {data.high_volume_threshold}+ NBA games league-wide on that date. This page reports schedule shape; it does not prescribe roster moves.
      </p>
    </div>
  )
}
