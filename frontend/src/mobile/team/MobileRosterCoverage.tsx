import { useMemo } from 'react'
import { useGetScheduleQuery } from '../../store/api/fantasyApi'
import type { Player } from '../../types/api'
import { SCHEDULE_HORIZONS, type ScheduleHorizon } from '../../components/PlayerWeekColumns'
import { firstScheduleDay, formatSlateDate } from '../../utils/slateWindow'
import { getErrorMessage } from '../../utils/errorMessage'
import { Card, Segmented } from '../ui'

const HORIZON_OPTIONS = SCHEDULE_HORIZONS.map((h) => ({ value: String(h) as `${ScheduleHorizon}`, label: `${h} days` }))

/**
 * Roster coverage bar chart for the phone Team page: the same numbers as
 * components/RosterCoverage (rostered players with an NBA game per day vs. the
 * slate size), drawn in the redesign's card.
 */
export default function MobileRosterCoverage({
  players,
  horizon,
  onHorizonChange,
  selectedDate,
  onSelectDate,
}: {
  players: Player[]
  horizon: ScheduleHorizon
  onHorizonChange: (h: ScheduleHorizon) => void
  selectedDate: string | null
  onSelectDate: (date: string) => void
}) {
  const { data: schedule, isLoading, error } = useGetScheduleQuery()
  const days = useMemo(() => schedule?.calendar_days ?? [], [schedule])
  const start = useMemo(() => firstScheduleDay(days), [days])
  const visible = useMemo(() => {
    if (!start) return []
    const i = days.findIndex((d) => d.date === start)
    return days.slice(i, i + horizon)
  }, [days, start, horizon])
  const coverage = useMemo(
    () =>
      visible.map((day) => {
        const playing = new Set(
          (schedule?.teams ?? []).filter((t) => t.games.some((g) => g.date === day.date)).map((t) => t.abbreviation),
        )
        return { day, count: players.filter((p) => playing.has(p.pro_team)).length }
      }),
    [visible, schedule, players],
  )
  const active = visible.some((d) => d.date === selectedDate) ? selectedDate : visible[0]?.date

  return (
    <Card title="Roster coverage">
      <span className="mr-meta">
        Games on your roster vs. the NBA slate. Bar height = rostered players with an NBA game; the slate label is the
        total number of NBA games that day.
      </span>
      <Segmented
        label="Coverage days"
        size="sm"
        options={HORIZON_OPTIONS}
        value={String(horizon) as `${ScheduleHorizon}`}
        onChange={(v) => onHorizonChange(Number(v) as ScheduleHorizon)}
      />
      {isLoading ? (
        <span className="mr-meta">Loading schedule…</span>
      ) : error ? (
        <span className="mr-meta">{getErrorMessage(error, 'Failed to load schedule coverage')}</span>
      ) : (
        <div className="mr-cov mr-noscroll">
          {coverage.map(({ day, count }) => (
            <button
              key={day.date}
              type="button"
              className="mr-cov-day"
              aria-pressed={active === day.date}
              aria-label={`${formatSlateDate(day.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${count} of ${players.length} rostered players have an NBA game; ${day.slate_size} NBA games on the slate`}
              onClick={() => onSelectDate(day.date)}
            >
              <span className="mr-cov-dow">{formatSlateDate(day.date, { weekday: 'short' })}</span>
              <span className="mr-cov-date">{formatSlateDate(day.date, { month: 'short', day: 'numeric' })}</span>
              <span className="mr-cov-bar" aria-hidden="true">
                <span className="mr-cov-fill" style={{ height: `${players.length ? (count / players.length) * 100 : 0}%` }} />
              </span>
              <span className="mr-cov-n">
                <b>{count}</b> of {players.length}
              </span>
              <span className="mr-cov-n">rostered</span>
              <span className={`mr-cov-slate ${day.slate_size >= 12 || day.high_volume ? 'mr-busy' : ''}`.trim()}>
                {day.slate_size} NBA games
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="mr-legend">
        <span><i style={{ background: 'var(--mr-primary-2)' }} />Bar height = rostered players with a game</span>
        <span><i className="mr-cov-bar" style={{ width: 11, height: 11, margin: 0 }} />Slate label = total NBA games</span>
      </div>
    </Card>
  )
}
