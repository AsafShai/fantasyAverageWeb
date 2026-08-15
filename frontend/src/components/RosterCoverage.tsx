import { useMemo, useState } from 'react'
import { useGetAllPlayersQuery, useGetScheduleQuery } from '../store/api/fantasyApi'
import type { Player, ScheduleCalendarDay } from '../types/api'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import { firstScheduleDay, formatSlateDate } from '../utils/slateWindow'

interface RosterCoverageProps {
  players: Player[]
  teamId: number
}

function daySurface(day: ScheduleCalendarDay): string {
  return day.slate_size > 0 ? 'bg-white text-gray-800' : 'bg-gray-50 text-gray-500'
}

function slateTone(day: ScheduleCalendarDay): string {
  if (day.slate_size >= 12) return 'bg-blue-100 text-blue-900'
  if (day.high_volume) return 'bg-blue-50 text-blue-800'
  if (day.slate_size > 0) return 'bg-gray-100 text-gray-700'
  return 'bg-gray-100 text-gray-500'
}

export default function RosterCoverage({ players, teamId }: RosterCoverageProps) {
  const { data: schedule, isLoading, error } = useGetScheduleQuery()
  const { data: allPlayerData } = useGetAllPlayersQuery({ limit: 500 }, { skip: players.length > 0 })
  const [horizon, setHorizon] = useState<14 | 28>(14)
  const [selectedDate, setSelectedDate] = useState('')

  const days = useMemo(() => schedule?.calendar_days ?? [], [schedule])
  const roster = useMemo(() => {
    if (players.length > 0) return players
    return (allPlayerData?.players ?? []).filter(player => player.status === 'ONTEAM' && player.team_id === teamId)
  }, [allPlayerData, players, teamId])
  const startDate = useMemo(() => firstScheduleDay(days), [days])
  const visibleDays = useMemo(() => {
    if (!startDate) return []
    const startIndex = days.findIndex(day => day.date === startDate)
    return days.slice(startIndex, startIndex + horizon)
  }, [days, horizon, startDate])

  const coverage = useMemo(() => visibleDays.map(day => {
    const activeTeams = new Set(
      (schedule?.teams ?? []).filter(team => team.games.some(game => game.date === day.date)).map(team => team.abbreviation)
    )
    return { day, count: roster.filter(player => activeTeams.has(player.pro_team)).length }
  }), [roster, schedule, visibleDays])

  const activeDate = visibleDays.some(day => day.date === selectedDate) ? selectedDate : visibleDays[0]?.date ?? ''

  if (isLoading) return <div className="bg-white rounded-lg shadow p-6"><LoadingSpinner /></div>
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load schedule coverage')} />
  if (!schedule || !visibleDays.length) return null

  return (
    <div className="bg-white rounded-lg shadow p-4 sm:p-6">
      <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">Roster coverage</h2>
          <p className="mt-1 text-xs text-gray-500">Bar height = rostered players with an NBA game. The slate label is the total number of NBA games that day.</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 p-1 text-xs">
          {[14, 28].map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setHorizon(value as 14 | 28)}
              className={`rounded-md px-3 py-2 ${horizon === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {value} days
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {coverage.map(({ day, count }) => (
          <button
            type="button"
            key={day.date}
            onClick={() => setSelectedDate(day.date)}
            className={`w-16 min-w-16 shrink-0 rounded-lg px-1.5 py-2 text-center leading-none transition-shadow ${daySurface(day)} ${activeDate === day.date ? 'border-[3px] border-blue-700 shadow-sm' : 'border-2 border-gray-200'}`}
            aria-pressed={activeDate === day.date}
            aria-label={`${formatSlateDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${count} of ${roster.length} rostered players have an NBA game; ${day.slate_size} NBA games on the slate`}
          >
            <div className="text-[10px] font-semibold uppercase leading-none">{formatSlateDate(day.date, { weekday: 'short' })}</div>
            <div className="text-xs leading-none">{formatSlateDate(day.date, { month: 'short', day: 'numeric' })}</div>
            <div className="mt-2 flex h-24 items-end justify-center" aria-hidden="true">
              <div className="relative h-full w-6 overflow-hidden rounded-t bg-blue-100">
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t bg-blue-600"
                  style={{ height: `${roster.length ? (count / roster.length) * 100 : 0}%` }}
                />
              </div>
            </div>
            <div className="mt-2 flex items-baseline justify-center gap-1 leading-none">
              <span className="text-lg font-bold">{count}</span>
              <span className="text-[9px] font-semibold uppercase">of {roster.length}</span>
            </div>
            <div className="mt-1 text-[9px] leading-none">rostered</div>
            <div className={`mt-1 rounded-md px-1 py-1 text-[9px] font-medium leading-tight ${slateTone(day)}`}>{day.slate_size} NBA games</div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-600 align-[-2px]" />Bar height = rostered players with a game</span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-100 align-[-2px]" />Slate label = total NBA games</span>
      </div>
    </div>
  )
}
