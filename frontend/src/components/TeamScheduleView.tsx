import { Fragment } from 'react'
import { Link, useNavigate } from 'react-router'
import { useGetScheduleQuery } from '../store/api/fantasyApi'
import { METRIC_GLOSSARY } from '../constants/metricGlossary'
import InfoTip from './InfoTip'
import LoadingSpinner from './LoadingSpinner'
import ErrorMessage from './ErrorMessage'
import { NbaTeamLogo } from './NbaTeamSelect'
import { getErrorMessage } from '../utils/errorMessage'
import type { ScheduleGame, ScheduleTeam } from '../types/api'
import { useTeamScheduleView } from '../hooks/useTeamScheduleView'
import {
  boxScoreHref,
  easternToday,
  formatScheduleDate as formatDate,
  monthKey,
  monthLabel,
  slateLevel,
  type ScheduleRow,
  type ScheduleView,
} from '../utils/teamSchedule'

interface TeamScheduleViewProps {
  teamId: string
}

const VIEW_LABELS: { value: ScheduleView; label: string }[] = [
  { value: 'results', label: 'Results' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All' },
]

function slateClass(game: ScheduleGame): string {
  const level = slateLevel(game)
  if (level === 2) return 'bg-blue-200 text-blue-900 dark:bg-blue-800 dark:text-blue-100'
  if (level === 1) return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
  return 'text-gray-700'
}

function Kpi({ label, value, metric }: { label: string; value: string | number; metric?: keyof typeof METRIC_GLOSSARY }) {
  const info = metric ? METRIC_GLOSSARY[metric] : null
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
        {label}{info && <InfoTip title={info.title} body={info.body} />}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-gray-900">{value}</div>
    </div>
  )
}

function restLabel(game: ScheduleGame): string {
  return game.rest_days === null ? '—' : game.rest_days === 0 ? '0 · B2B' : `${game.rest_days}d`
}

function ResultMark({ row }: { row: ScheduleRow }) {
  const result = row.result
  if (!result) return <span className="text-gray-400">—</span>
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span
        className={`inline-grid h-6 w-6 place-items-center rounded-md text-xs font-bold ${result.won ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'}`}
      >
        {result.won ? 'W' : 'L'}
      </span>
      <span className="font-semibold text-gray-900">{result.team_score}-{result.opponent_score}</span>
    </span>
  )
}

function resultLabel(row: ScheduleRow): string {
  const { game, result } = row
  const where = game.is_home ? 'vs' : 'at'
  const outcome = result ? `${result.won ? 'Win' : 'Loss'} ${result.team_score}-${result.opponent_score} ` : ''
  return `Box score: ${outcome}${where} ${game.opponent}, ${formatDate(game.date, { month: 'short', day: 'numeric' })}`
}

export default function TeamScheduleView({ teamId }: TeamScheduleViewProps) {
  const { data, isLoading, error } = useGetScheduleQuery()
  const team = data?.teams.find(item => item.team_id === Number(teamId))

  if (isLoading) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load team schedule')} />
  if (!team) return <p className="text-sm text-gray-500">Select a team to view its schedule.</p>
  return <ScheduleBody key={team.team_id} team={team} />
}

function ScheduleBody({ team }: { team: ScheduleTeam }) {
  const navigate = useNavigate()
  const [s, scrollRef] = useTeamScheduleView(team)
  const { view, shown, todayIndex } = s
  const showToday = view === 'all' && todayIndex > 0 && todayIndex < shown.length
  const headings = view === 'results'
    ? ['Date', 'Opponent', 'Result', 'Box score']
    : view === 'upcoming'
      ? ['Date', 'Opponent', 'Rest days', 'Slate size']
      : ['Date', 'Opponent', 'Result · rest', 'Box score · slate']
  const empty = view === 'results' ? 'No games played yet.' : view === 'upcoming' ? 'No games left this season.' : 'No games published yet.'

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          <NbaTeamLogo abbr={team.abbreviation} size={36} />
          <div>
            <h2 id="nba-team-schedule-heading" className="text-xl font-bold text-gray-900">{team.team_name} schedule</h2>
            <p className="text-sm text-gray-500">
              {s.record ? `${s.record.record} · ` : ''}{s.played} played, {s.left} left
            </p>
          </div>
        </div>
        <div role="group" aria-label="Show games" className="grid w-full grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 sm:w-96 dark:bg-gray-800">
          {VIEW_LABELS.map(option => {
            const on = option.value === view
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => s.setView(option.value)}
                className={`min-h-9 rounded-md px-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${on ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                {option.label} <span className="font-medium text-gray-400">{s.counts[option.value]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {team.total_games < 82 && view !== 'results' && (
        <div className="mb-4 max-w-md rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          <span className="font-semibold">{team.total_games} games are published.</span> Two Cup knockout slots are held for mid-December and will be added when scheduled.
        </div>
      )}

      <div className={`mb-5 grid gap-2 ${view === 'upcoming' ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {view === 'upcoming' && (
          <>
            <Kpi label="Games left" value={s.left} metric="scheduleLeft" />
            <Kpi label="Back-to-backs left" value={s.b2bLeft} metric="scheduleB2BLeft" />
            <Kpi label="High-volume left" value={s.highVolumeLeft} metric="scheduleHighVolumeLeft" />
          </>
        )}
        {view === 'results' && (
          <>
            <Kpi label="Record" value={s.record?.record ?? '—'} />
            <Kpi label="Home" value={s.record?.home ?? '—'} />
            <Kpi label="Away" value={s.record?.away ?? '—'} />
            <Kpi label="Last 10" value={s.record?.last10 ?? '—'} />
          </>
        )}
        {view === 'all' && (
          <>
            <Kpi label="Record" value={s.record?.record ?? '—'} />
            <Kpi label="Played" value={s.played} />
            <Kpi label="Games left" value={s.left} metric="scheduleLeft" />
            <Kpi label="Back-to-backs left" value={s.b2bLeft} metric="scheduleB2BLeft" />
          </>
        )}
      </div>
      {s.resultsFailed && view !== 'upcoming' && (
        <p className="mb-2 text-xs text-gray-500">Scores could not be loaded; box score links still work.</p>
      )}

      <div ref={scrollRef} data-testid="team-schedule-scroll" className="max-h-[34rem] overflow-auto rounded-lg border border-gray-200">
        <table className="min-w-[650px] w-full table-fixed border-collapse text-sm" aria-label={`${team.team_name} schedule`}>
          <colgroup>
            <col className="w-40 sm:w-1/4" />
            <col className="sm:w-1/4" />
            <col className="w-36 sm:w-1/4" />
            <col className="w-32 sm:w-1/4" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="border-b border-gray-200 px-3 py-3 text-left sm:text-center">{headings[0]}</th>
              <th className="border-b border-gray-200 px-3 py-3 text-center">{headings[1]}</th>
              <th className="border-b border-gray-200 px-3 py-3 text-right sm:text-center">{headings[2]}</th>
              <th className="border-b border-gray-200 px-3 py-3 text-right sm:text-center">{headings[3]}</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-500">{empty}</td>
              </tr>
            )}
            {shown.map((row, index) => {
              const { game } = row
              const previous = shown[index - 1]
              const showMonth = !previous || monthKey(previous.game.date) !== monthKey(game.date)
              const href = boxScoreHref(game)
              return (
                <Fragment key={game.game_id}>
                  {showToday && index === todayIndex && (
                    <tr data-testid="schedule-today">
                      <td colSpan={4} className="border-y border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                        <span className="inline-flex items-center gap-2">
                          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-blue-600" />
                          Today · {formatDate(easternToday(), { month: 'short', day: 'numeric' })}
                        </span>
                      </td>
                    </tr>
                  )}
                  {showMonth && (
                    <tr className="bg-blue-50/70 dark:bg-gray-700">
                      <th colSpan={4} className="px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-blue-800 dark:text-blue-200">{monthLabel(game.date)}</th>
                    </tr>
                  )}
                  <tr
                    data-row-index={index}
                    onClick={row.played ? () => navigate(href) : undefined}
                    className={`border-b border-gray-100 last:border-0 hover:bg-gray-50 ${row.played ? 'cursor-pointer' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-left text-gray-700 sm:text-center">{formatDate(game.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                    <td className="px-3 py-3 font-medium text-gray-800">
                      <span className="flex items-center justify-center gap-2">
                        <span className="w-5 text-xs font-bold text-gray-400">{game.is_home ? 'vs' : '@'}</span>
                        <NbaTeamLogo abbr={game.opponent_abbreviation} size={22} />
                        <span className="truncate">{game.opponent}</span>
                      </span>
                    </td>
                    {row.played ? (
                      <>
                        <td className="px-3 py-3 text-right sm:text-center"><ResultMark row={row} /></td>
                        <td className="px-3 py-3 text-right sm:text-center">
                          <Link
                            to={href}
                            onClick={event => event.stopPropagation()}
                            aria-label={resultLabel(row)}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                          >
                            Box score
                            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3l5 5-5 5" /></svg>
                          </Link>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={`px-3 py-3 text-right sm:text-center ${game.rest_days === 0 ? 'font-semibold text-rose-600' : 'text-gray-700'}`}>{restLabel(game)}</td>
                        <td className={`px-3 py-3 text-right sm:text-center font-medium ${slateClass(game)}`}>{game.slate_size}</td>
                      </>
                    )}
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
