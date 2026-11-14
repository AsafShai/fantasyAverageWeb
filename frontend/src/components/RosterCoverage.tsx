import { useEffect, useMemo, useState } from 'react'
import { useGetAllPlayersQuery, useGetScheduleQuery } from '../store/api/fantasyApi'
import type { Player, ScheduleCalendarDay } from '../types/api'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import { RosterCoverageBar } from './RosterCoverageBar'
import { rosterDayCoverage, teamsPlayingOnDate } from '../utils/rosterCoverage'
import { firstScheduleDay, formatSlateDate, opponentsByTeamDate } from '../utils/slateWindow'
import { SCHEDULE_HORIZONS, type ScheduleHorizon } from './PlayerWeekColumns'

interface RosterCoverageProps {
  players: Player[]
  teamId: number
  horizon: ScheduleHorizon
  onHorizonChange: (horizon: ScheduleHorizon) => void
  onSelectDate?: (date: string) => void
  onActiveDate?: (date: string) => void
  /** When set to a date in the visible window, highlights that column (e.g. roster Schedule day picker). */
  externalSelectedDate?: string | null
  /** Skip card shell when nested in a collapsible. */
  embedded?: boolean
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

export default function RosterCoverage({
  players,
  teamId,
  horizon,
  onHorizonChange,
  onSelectDate,
  onActiveDate,
  externalSelectedDate,
  embedded = false,
}: RosterCoverageProps) {
  const { data: schedule, isLoading, error } = useGetScheduleQuery()
  const { data: allPlayerData } = useGetAllPlayersQuery({ limit: 500 }, { skip: players.length > 0 })
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

  const opponents = useMemo(
    () => (schedule ? opponentsByTeamDate(schedule) : new Map<string, string>()),
    [schedule],
  )
  const coverage = useMemo(
    () =>
      visibleDays.map((day) => {
        const playingTeams = teamsPlayingOnDate(schedule, day.date)
        const { count, b2bCount } = rosterDayCoverage(roster, playingTeams, day.date, opponents)
        return { day, count, b2bCount }
      }),
    [roster, schedule, visibleDays, opponents],
  )

  const activeDate = visibleDays.some(day => day.date === selectedDate) ? selectedDate : visibleDays[0]?.date ?? ''

  useEffect(() => {
    if (!externalSelectedDate || !visibleDays.some(d => d.date === externalSelectedDate)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the parent's date when it changes
    setSelectedDate(externalSelectedDate)
  }, [externalSelectedDate, visibleDays])

  useEffect(() => {
    if (activeDate) onActiveDate?.(activeDate)
  }, [activeDate, onActiveDate])

  if (isLoading) {
    return embedded
      ? <div className="p-6"><LoadingSpinner /></div>
      : <div className="rounded-lg bg-white p-6 shadow"><LoadingSpinner /></div>
  }
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load schedule coverage')} />
  if (!schedule || !visibleDays.length) return null

  const shell = embedded ? 'p-4 sm:p-6 dark:bg-gray-800' : 'rounded-lg bg-white p-4 shadow sm:p-6 dark:bg-gray-800'

  return (
    <div className={shell}>
      <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${embedded ? 'pb-4' : 'border-b border-gray-100 pb-4 dark:border-gray-700'}`}>
        <div>
          {embedded ? <h2 className="sr-only">Roster coverage</h2> : (
            <h2 className="text-xl font-bold text-gray-900 sm:text-2xl dark:text-gray-100">Roster coverage</h2>
          )}
          <p className="mt-1 text-xs text-gray-500 sm:hidden dark:text-gray-400">
            Blue bar = players with a game; orange at bottom = players on B2B.
          </p>
          <p className="mt-1 hidden text-xs text-gray-500 sm:block dark:text-gray-400">
            Blue bar = rostered players with a game; orange at the bottom = players on B2B (count under each day).
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 p-1 text-xs">
          {SCHEDULE_HORIZONS.map(value => (
            <button
              key={value}
              type="button"
              onClick={() => onHorizonChange(value)}
              className={`rounded-md px-4 py-3 sm:px-3 sm:py-2 ${horizon === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {value} days
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {coverage.map(({ day, count, b2bCount }) => (
          <button
            type="button"
            key={day.date}
            onClick={() => {
              setSelectedDate(day.date)
              onSelectDate?.(day.date)
            }}
            className={`w-16 min-w-16 shrink-0 rounded-lg px-1.5 py-2 text-center leading-none transition-shadow ${daySurface(day)} ${activeDate === day.date ? 'border-[3px] border-blue-700 shadow-sm' : 'border-2 border-gray-200'}`}
            aria-pressed={activeDate === day.date}
            aria-label={`${formatSlateDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${count} of ${roster.length} rostered players have an NBA game${b2bCount ? `, ${b2bCount} on a back-to-back` : ''}; ${day.slate_size} NBA games on the slate`}
          >
            <div className="text-[10px] font-semibold uppercase leading-none">{formatSlateDate(day.date, { weekday: 'short' })}</div>
            <div className="text-xs leading-none">{formatSlateDate(day.date, { month: 'short', day: 'numeric' })}</div>
            <div className="mt-2 flex h-24 items-end justify-center" aria-hidden="true">
              <RosterCoverageBar rosterSize={roster.length} count={count} b2bCount={b2bCount} />
            </div>
            <div className="mt-2 flex items-baseline justify-center gap-1 leading-none">
              <span className="text-lg font-bold">{count}</span>
              <span className="text-[9px] font-semibold uppercase">of {roster.length}</span>
            </div>
            <div className="mt-1 text-[9px] leading-none">rostered</div>
            {b2bCount > 0 ? (
              <div className="mt-0.5 text-[9px] font-medium leading-tight text-orange-800/85 dark:text-orange-200/80">
                {b2bCount} players on B2B
              </div>
            ) : null}
            <div className={`mt-1 rounded-md px-1 py-1 text-[9px] font-medium leading-tight ${slateTone(day)}`}>{day.slate_size} NBA games</div>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-600 align-[-2px]" />Players with a game</span>
        <span>
          <span className="mr-1 inline-block h-3 w-3 rounded-sm bg-orange-400 align-[-2px] dark:bg-orange-600" />
          Players on B2B
        </span>
        <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-100 align-[-2px]" />Slate label = total NBA games</span>
      </div>
    </div>
  )
}
