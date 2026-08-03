import { useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { useGetNbaPlayerQuery, useGetNbaPlayerStatsQuery } from '../store/api/fantasyApi'
import type { CustomDateRange, PlayerStats, TimePeriod } from '../types/api'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { CoverageNotice } from '../components/DateRangePicker'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

function backLabel(from: string | undefined): string {
  if (!from) return '← Back'
  if (from.startsWith('/nba-teams')) return '← Back to NBA Depth Charts'
  if (from.startsWith('/players')) return '← Back to Players'
  if (from.startsWith('/team/')) return '← Back to Team'
  if (from.startsWith('/player-rankings')) return '← Back to Player Rankings'
  return '← Back'
}

const STAT_ROWS: { key: keyof PlayerStats; label: string; isPct?: boolean }[] = [
  { key: 'gp', label: 'GP' },
  { key: 'minutes', label: 'MIN' },
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'three_pm', label: '3PM' },
  { key: 'fgm', label: 'FGM' },
  { key: 'fga', label: 'FGA' },
  { key: 'fg_percentage', label: 'FG%', isPct: true },
  { key: 'ftm', label: 'FTM' },
  { key: 'fta', label: 'FTA' },
  { key: 'ft_percentage', label: 'FT%', isPct: true },
]

function formatStat(value: number, isPct?: boolean): string {
  if (isPct) return `${(value * 100).toFixed(1)}%`
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(1)
}

const PlayerProfile = () => {
  const { playerId = '' } = useParams<{ playerId: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  const [showAverages, setShowAverages] = useState(true)

  const handleBack = () => {
    if (from) {
      navigate(from)
      return
    }
    if (window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/')
  }

  const {
    data: bio,
    error: bioError,
    isLoading: bioLoading,
  } = useGetNbaPlayerQuery(playerId, { skip: !playerId })

  const customParams =
    timePeriod === 'custom' && customRange
      ? { start: customRange.start, end: customRange.end }
      : {}

  const {
    data: statsResponse,
    error: statsError,
    isLoading: statsLoading,
    isFetching: statsFetching,
  } = useGetNbaPlayerStatsQuery(
    { playerId, time_period: timePeriod, ...customParams },
    { skip: !playerId || (timePeriod === 'custom' && !customRange) },
  )

  if (!playerId) return <ErrorMessage message="Missing player id" />
  if (bioLoading) return <LoadingSpinner />
  if (bioError || !bio) return <ErrorMessage message="Failed to load player" />

  const stats = showAverages ? statsResponse?.averages : statsResponse?.totals
  const hasData = Boolean(statsResponse?.has_data && stats)

  return (
    <div className="max-w-5xl mx-auto px-4">
      <div className="mb-4">
        <button
          type="button"
          onClick={handleBack}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          {backLabel(from)}
        </button>
      </div>

      <div className="mb-8 flex flex-col sm:flex-row gap-6 items-start">
        <div className="shrink-0 w-28 h-28 sm:w-36 sm:h-36 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
          {bio.photo_url ? (
            <img
              src={bio.photo_url}
              alt={bio.display_name}
              className="w-full h-full object-cover object-top"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-3xl text-gray-400">
              🏀
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">
            {bio.display_name}
            {bio.jersey_number ? (
              <span className="ml-2 text-gray-500 dark:text-gray-400 font-semibold text-2xl">
                #{bio.jersey_number}
              </span>
            ) : null}
          </h1>
          <p className="text-gray-700 dark:text-gray-300 text-lg mb-3">
            {bio.team} ({bio.team_abbr}) · {bio.position}
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Conference</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-medium">{bio.conference}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Division</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-medium">{bio.division}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Height</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-medium">{bio.height ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Age</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-medium">{bio.age ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Nationality</dt>
              <dd className="text-gray-900 dark:text-gray-100 font-medium">{bio.nationality ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start mb-4 gap-3">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Stats</h2>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start gap-3">
            <TimePeriodSelector
              value={timePeriod}
              onChange={setTimePeriod}
              customRange={customRange}
              onCustomRangeChange={setCustomRange}
            />
            <div className="flex self-start border border-gray-300 dark:border-gray-600 rounded overflow-hidden">
              <button
                type="button"
                className={`flex-1 sm:flex-none px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 border-r border-gray-300 dark:border-gray-600 ${
                  showAverages
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                onClick={() => setShowAverages(true)}
              >
                Per Game
              </button>
              <button
                type="button"
                className={`flex-1 sm:flex-none px-3 py-1.5 text-sm whitespace-nowrap transition-all duration-200 ${
                  !showAverages
                    ? 'bg-blue-600 text-white font-medium'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
                onClick={() => setShowAverages(false)}
              >
                Totals
              </button>
            </div>
          </div>
        </div>

        {timePeriod === 'custom' && customRange && (
          <CoverageNotice
            requestedStart={customRange.start}
            requestedEnd={customRange.end}
            actualStart={statsResponse?.actual_start ?? undefined}
            actualEnd={statsResponse?.actual_end ?? undefined}
          />
        )}

        {statsLoading || statsFetching ? (
          <div className="py-10">
            <LoadingSpinner />
          </div>
        ) : statsError ? (
          <ErrorMessage message="Failed to load player stats" />
        ) : !hasData || !stats ? (
          <div className="py-12 text-center text-gray-400 text-sm">
            No stats available for this time range.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {STAT_ROWS.map((row) => (
                    <th
                      key={row.key}
                      className="px-3 py-2 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider"
                    >
                      {row.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-900">
                <tr>
                  {STAT_ROWS.map((row) => (
                    <td
                      key={row.key}
                      className="px-3 py-3 text-center text-gray-900 dark:text-gray-100 font-medium whitespace-nowrap"
                    >
                      {formatStat(stats[row.key], row.isPct)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default PlayerProfile
