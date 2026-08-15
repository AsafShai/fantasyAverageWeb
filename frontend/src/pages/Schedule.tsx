import { useMemo } from 'react'
import InfoTip from '../components/InfoTip'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { useGetScheduleQuery } from '../store/api/fantasyApi'
import { METRIC_GLOSSARY } from '../constants/metricGlossary'
import { getErrorMessage } from '../utils/errorMessage'

const MONTHS = ['October', 'November', 'December', 'January', 'February', 'March', 'April']

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
  const monthlyValues = useMemo(
    () => data?.teams.flatMap(team => MONTHS.map(month => team.monthly_games[month] ?? 0)) ?? [],
    [data]
  )
  const minMonthly = monthlyValues.length ? Math.min(...monthlyValues) : 0
  const maxMonthly = monthlyValues.length ? Math.max(...monthlyValues) : 0

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

      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        <span className="font-medium text-gray-700">Season {data.season}</span>
        <span>·</span>
        <span>Blue cells show relative month density.</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-100" /> higher month count</span>
        <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-blue-200" /> highest month count</span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 bg-white shadow">
        <table className="min-w-[980px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="sticky left-0 z-30 border-b border-gray-200 bg-gray-50 px-3 py-3 text-left">Team</th>
              {MONTHS.map(month => <th key={month} className="border-b border-gray-200 px-3 py-3 text-right">{month}</th>)}
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="Total" metric="scheduleTotal" /></th>
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="B2B" metric="scheduleB2B" /></th>
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="High volume" metric="scheduleHighVolume" /></th>
              <th className="border-b border-gray-200 px-3 py-3 text-right"><MetricHeader label="Avg rest" metric="scheduleRest" /></th>
            </tr>
          </thead>
          <tbody>
            {data.teams.map(team => (
              <tr key={team.team_id} className="border-b border-gray-100 last:border-0 hover:bg-blue-50/40">
                <th className="sticky left-0 z-10 whitespace-nowrap border-r border-gray-100 bg-white px-3 py-3 text-left font-semibold text-gray-800">
                  {team.team_name}
                </th>
                {MONTHS.map(month => {
                  const value = team.monthly_games[month] ?? 0
                  return <td key={month} className={`px-3 py-3 text-right font-medium ${heatClass(value, minMonthly, maxMonthly)}`}>{value}</td>
                })}
                <td className="px-3 py-3 text-right font-semibold text-gray-800">{team.total_games}</td>
                <td className="px-3 py-3 text-right text-gray-700">{team.b2b_count}</td>
                <td className="px-3 py-3 text-right text-gray-700">{team.high_volume_games}</td>
                <td className="px-3 py-3 text-right text-gray-700">{team.avg_rest_days === null ? '—' : `${team.avg_rest_days.toFixed(2)}d`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-gray-500">High-volume means {data.high_volume_threshold}+ NBA games league-wide on that date. This page reports schedule shape; it does not prescribe roster moves.</p>
    </div>
  )
}
