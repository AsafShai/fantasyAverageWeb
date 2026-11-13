import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  useGetLeagueSummaryQuery,
  useGetRankChangesQuery,
  useGetRankingsQuery,
  useGetTodayHubQuery,
} from '../../store/api/fantasyApi'
import type { AverageStats, LeagueSummary, RankingStats } from '../../types/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { useLiveQuery } from '../../hooks/useLiveQuery'
import { averagesNote } from '../../utils/live'
import { LiveBadgeMobile } from '../ui/LiveBadgeMobile'
import { MyTeamMark } from '../../components/MyTeamMark'
import { useMyTeam } from '../../context/MyTeamContext'
import { getErrorMessage } from '../../utils/errorMessage'
import { FF_LEAGUE_ACTIVITY } from '../../config/featureFlags'
import { Card } from '../ui/Card'
import { RankMoversCard } from './RankMoversCard'
import { RosterHealthCard } from './RosterHealthCard'
import { LatestMovesCard } from './LatestMovesCard'
import { arrowDelta } from './groupMovers'
import './today.css'

const DEADLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/** Links to the full version of each card's information. */
const STANDINGS = '/rankings?view=standings'
const STANDINGS_VALUES = '/rankings?view=standings&mode=averages'

function formatSlate(slateDate: string | null): string {
  if (!slateDate) return 'No games scheduled'
  return new Date(slateDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Trade deadline countdown, shown only in its last 7 days (as today). */
function DeadlineCard({ deadline }: { deadline: string | null }) {
  const navigate = useNavigate()
  const deadlineMs = deadline ? new Date(deadline).getTime() : null
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadlineMs) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadlineMs])

  const left = deadlineMs ? deadlineMs - now : 0
  if (!deadlineMs || left <= 0 || left > DEADLINE_WINDOW_MS) return null

  const s = Math.floor(left / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const parts = [
    { v: Math.floor(s / 86400), l: 'Days', u: 'd' },
    { v: Math.floor((s % 86400) / 3600), l: 'Hours', u: 'h' },
    { v: Math.floor((s % 3600) / 60), l: 'Minutes', u: 'm' },
    { v: s % 60, l: 'Seconds', u: 's' },
  ]
  const label = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(deadlineMs)

  return (
    <button type="button" className="mr-today-dead" onClick={() => navigate('/trade')}>
      <span className="mr-today-dl">Trade Deadline</span>
      <span className="mr-today-dv mr-num" role="timer" aria-label={parts.map((p) => `${p.v} ${p.l}`).join(', ')}>
        {parts.map((p) => (
          <span key={p.u}>
            {pad(p.v)}
            <i>{p.u}</i>
          </span>
        ))}
      </span>
      <span className="mr-today-ds">{label} · Trade Analyzer ›</span>
    </button>
  )
}

/** Top 5 Teams (average) as the dark highlight card, with the points change since yesterday. */
function TopTeamsCard({ teams }: { teams: RankingStats[] }) {
  const navigate = useNavigate()
  const { isMyTeam } = useMyTeam()
  const { data: changes } = useGetRankChangesQuery('averages')
  const delta = (id: number) => changes?.teams.find((t) => t.team_id === id)?.total_delta ?? null

  return (
    <section className="mr-today-race" aria-labelledby="mr-today-top5">
      <div className="mr-card-head">
        <h2 id="mr-today-top5" className="mr-h2">Top 5 Teams (average)</h2>
        <span className="mr-today-race-meta">pts · since yesterday</span>
      </div>
      <ol>
        {teams.map((t, i) => {
          const d = delta(t.team.team_id)
          return (
            <li key={t.team.team_id}>
              <button
                type="button"
                className={`mr-today-rr ${isMyTeam(t.team.team_id) ? 'mr-me' : ''}`.trim()}
                onClick={() => navigate(`/team/${t.team.team_id}`)}
              >
                <span className="mr-today-rn">{i + 1}</span>
                <span className="mr-today-rt">
                  <span className="mr-today-trunc">{t.team.team_name}</span>
                  <MyTeamMark teamId={t.team.team_id} />
                </span>
                <span className="mr-today-rp mr-num">
                  {t.total_points}
                  <span className="sr-only"> pts</span>
                </span>
                <span className={`mr-today-rd ${d && d > 0 ? 'mr-today-up' : 'mr-today-down'}`}>
                  {d ? arrowDelta(d) : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <Link to={STANDINGS} className="mr-btn mr-today-dark-btn">
        Full standings
      </Link>
    </section>
  )
}

const AVERAGE_TILES: { label: string; value: (a: AverageStats) => string }[] = [
  { label: 'FG%', value: (a) => a.fg_percentage.toFixed(3) },
  { label: 'FT%', value: (a) => a.ft_percentage.toFixed(3) },
  { label: '3PM', value: (a) => a.three_pm.toFixed(2) },
  { label: 'REB', value: (a) => a.reb.toFixed(2) },
  { label: 'AST', value: (a) => a.ast.toFixed(2) },
  { label: 'STL', value: (a) => a.stl.toFixed(2) },
  { label: 'BLK', value: (a) => a.blk.toFixed(2) },
  { label: 'PTS', value: (a) => a.pts.toFixed(2) },
  { label: 'GP', value: (a) => a.gp.toFixed(2) },
]

function LeagueAveragesCard({ summary }: { summary: LeagueSummary }) {
  const tiles = [
    ...AVERAGE_TILES.map((t) => ({ label: t.label, value: t.value(summary.league_averages) })),
    { label: 'NBA pace', value: summary.nba_avg_pace == null ? '—' : summary.nba_avg_pace.toFixed(1) },
    { label: 'Days left', value: String(summary.nba_game_days_left ?? 0) },
    { label: 'Teams', value: String(summary.total_teams) },
  ]
  return (
    <Card
      title="League averages"
      action={
        <Link to={STANDINGS_VALUES} className="mr-link">
          Standings ›
        </Link>
      }
    >
      <span className="mr-meta mr-today-sub">{summary.live?.active ? 'per team, season to date · incl. tonight’s finished games' : 'per team, season to date'}</span>
      <dl className="mr-today-tiles mr-today-c3">
        {tiles.map((t) => (
          <div key={t.label} className="mr-today-tile">
            <dt className="mr-today-tl">{t.label}</dt>
            <dd className="mr-today-tv mr-num">{t.value}</dd>
          </div>
        ))}
      </dl>
      <Link to={STANDINGS_VALUES} className="mr-btn">
        Compare teams in Standings
      </Link>
    </Card>
  )
}

/** Phone Today page (Home tab): same information as the desktop page, reorganized per the redesign. */
export default function MobileToday() {
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useLiveQuery(useGetLeagueSummaryQuery, undefined)
  const { data: rankings, error: rankingsError, isLoading: rankingsLoading } = useLiveQuery(useGetRankingsQuery, {})
  const { data: hub, isLoading: hubLoading, isError: hubError } = useGetTodayHubQuery()

  if (summaryLoading || rankingsLoading) return <LoadingSpinner />
  if (summaryError || rankingsError) {
    return <ErrorMessage message={getErrorMessage(summaryError ?? rankingsError, 'Failed to load dashboard data')} />
  }

  const topTeams = rankings?.averages_rankings.slice(0, 5) ?? []
  const slate = hub
    ? `${formatSlate(hub.slate_date)} · ${hub.games_count} ${hub.games_count === 1 ? 'game' : 'games'}`
    : hubError
      ? 'slate unavailable'
      : 'loading slate…'

  return (
    <div className="mr-root mr-today">
      <DeadlineCard deadline={summary?.trade_deadline ?? null} />

      <div className="mr-today-pt">
        <div className="mr-today-ptl">
          <h1 className="mr-h1">Today</h1>
          <LiveBadgeMobile live={summary?.live} espnUpdatedAt={summary?.espn_updated_at} note={averagesNote(summary?.live, 'averages', true)} noteClassName="mr-today-espn" />
        </div>
        {hub ? (
          <Link to="/box-scores" className="mr-link mr-today-slate">
            {slate} ›
          </Link>
        ) : (
          <span className="mr-meta mr-today-slate">{slate}</span>
        )}
      </div>

      <TopTeamsCard teams={topTeams} />

      {hubLoading ? (
        <Card>
          <p className="mr-meta">Loading movers and roster health…</p>
        </Card>
      ) : (
        <>
          <RankMoversCard movers={hub?.movers ?? []} />
          <RosterHealthCard
            slateDate={hub?.slate_date ?? null}
            gamesCount={hub?.games_count ?? 0}
            teams={hub?.roster_health ?? []}
          />
        </>
      )}

      {FF_LEAGUE_ACTIVITY && <LatestMovesCard />}

      {summary && <LeagueAveragesCard summary={summary} />}
    </div>
  )
}
