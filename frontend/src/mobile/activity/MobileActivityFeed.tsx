import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { ActivityMove, LeagueActivity, MoveKind as ActivityKind } from '../../types/activity'
import { useMyTeam } from '../../context/useMyTeam'
import { fantasyTeamOptionLabel } from '../../myTeam/display'
import { MyTeamMark } from '../../components/MyTeamMark'
import PlayerNameLink from '../../components/PlayerNameLink'
import { teamAbbrev, teamLookup, type TeamLookup } from '../../components/activity/teams'
import { MOVE_FILTERS, filterMoves, formatDay, localDay, moveMatchesKind, type MoveFilter } from '../../utils/leagueActivity'
import { Card, MoveKindPill, SelectSheet, type MoveKind } from '../ui'

const PAGE = 100
const ALL = 'all'

const KIND: Record<ActivityKind, { pill: MoveKind; label?: string }> = {
  add: { pill: 'added' },
  waiver: { pill: 'waiver' },
  drop: { pill: 'dropped' },
  trade_drop: { pill: 'dropped', label: 'Dropped for trade' },
  trade: { pill: 'trade' },
}

const timeOfDay = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function MoveItem({ move, teams }: { move: ActivityMove; teams: TeamLookup }) {
  const { isMyTeam } = useMyTeam()
  const mine = isMyTeam(move.team_id) || isMyTeam(move.other_team_id)
  const a = teamAbbrev(teams, move.team_id)
  const mark = mine && <MyTeamMark teamId={isMyTeam(move.team_id) ? move.team_id : move.other_team_id} />

  return (
    <li className={`mr-act-move ${mine ? 'mr-me' : ''}`.trim()} data-mine={mine || undefined}>
      <span className="mr-act-time mr-num">{timeOfDay(move.at)}</span>
      {move.kind === 'trade' ? (
        <div className="mr-act-body">
          <span className="mr-act-who">
            <b>
              {a} ⇄ {teamAbbrev(teams, move.other_team_id ?? 0)}
            </b>
            {mark}
          </span>
          <span className="mr-act-line">
            <Link to={`/activity?tab=trades&trade=${encodeURIComponent(move.trade_id ?? move.id)}`} className="mr-pill mr-pill-trade">
              Trade
            </Link>
          </span>
          <span>
            <b>{a}</b> got {move.added.map((p) => p.name).join(', ') || 'nothing'}
          </span>
          <span>
            <b>{teamAbbrev(teams, move.other_team_id ?? 0)}</b> got {move.dropped.map((p) => p.name).join(', ') || 'nothing'}
          </span>
        </div>
      ) : (
        <div className="mr-act-body">
          <span className="mr-act-who">
            <b>{a}</b>
            {mark}
          </span>
          <span className="mr-act-line">
            <MoveKindPill kind={KIND[move.kind].pill}>{KIND[move.kind].label}</MoveKindPill>
            {move.added.map((p) => (
              <span key={`a${p.player_id}`} className="mr-act-add">
                + <PlayerNameLink name={p.name} playerId={p.player_id} className="mr-act-plink" />
              </span>
            ))}
          </span>
          {move.dropped.map((p) => (
            <span key={`d${p.player_id}`} className="mr-act-drop">
              − <PlayerNameLink name={p.name} playerId={p.player_id} className="mr-act-plink" />
            </span>
          ))}
        </div>
      )}
    </li>
  )
}

/** Phone Activity tab: Team/Type sheets, From/To dates, counts, moves grouped by day. */
export default function MobileActivityFeed({ activity }: { activity: LeagueActivity }) {
  const { isMyTeam } = useMyTeam()
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const [teamId, setTeamId] = useState<number | null>(null)
  const [kind, setKind] = useState<MoveFilter>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [shown, setShown] = useState(PAGE)

  const moves = useMemo(() => filterMoves(activity.moves, { teamId, kind: 'all', from, to }), [activity.moves, teamId, from, to])
  const visible = useMemo(() => moves.filter((m) => moveMatchesKind(m.kind, kind)), [moves, kind])
  const count = (k: MoveFilter) => moves.filter((m) => moveMatchesKind(m.kind, k)).length
  const resetPaging = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setShown(PAGE)
  }

  const teamOptions = [
    { value: ALL, label: 'All teams' },
    ...activity.teams.map((t) => ({ value: String(t.team_id), label: fantasyTeamOptionLabel(t.name, isMyTeam(t.team_id)) })),
  ]
  const page = visible.slice(0, shown)

  return (
    <>
      <div className="mr-act-grid">
        <div className="mr-act-field">
          <span className="mr-meta">Team</span>
          <SelectSheet
            id="activity-team"
            label="Team"
            options={teamOptions}
            value={teamId === null ? ALL : String(teamId)}
            onChange={(v) => resetPaging(setTeamId)(v === ALL ? null : Number(v))}
            wide
          />
        </div>
        <div className="mr-act-field">
          <span className="mr-meta">Type</span>
          <SelectSheet id="activity-kind" label="Type" options={MOVE_FILTERS} value={kind} onChange={resetPaging(setKind)} wide />
        </div>
        <label className="mr-act-field">
          <span className="mr-meta">From</span>
          <input type="date" className="mr-act-date" value={from} max={to || undefined} onChange={(e) => resetPaging(setFrom)(e.target.value)} />
        </label>
        <label className="mr-act-field">
          <span className="mr-meta">To</span>
          <input type="date" className="mr-act-date" value={to} min={from || undefined} onChange={(e) => resetPaging(setTo)(e.target.value)} />
        </label>
      </div>

      <p className="mr-meta mr-act-summary mr-num">
        {count('all')} moves · {count('add')} adds · {count('drop')} drops · {count('waiver')} waiver claims · {count('trade')} trades
      </p>

      <Card>
        {visible.length === 0 ? (
          <p className="mr-meta mr-act-empty">
            {activity.moves.length === 0 ? 'No adds, drops or trades yet this season.' : 'No moves match these filters.'}
          </p>
        ) : (
          <ul className="mr-act-list" aria-label="Moves">
            {page.map((m, i) => {
              const day = localDay(m.at)
              const header = i === 0 || day !== localDay(page[i - 1].at)
              return (
                <Fragment key={m.id}>
                  {header && <li className="mr-act-day">{formatDay(day, { weekday: 'short', month: 'short', day: 'numeric' })}</li>}
                  <MoveItem move={m} teams={teams} />
                </Fragment>
              )
            })}
          </ul>
        )}
        {visible.length > shown && (
          <button type="button" className="mr-btn" onClick={() => setShown((s) => s + PAGE)}>
            Show more ({visible.length - shown} left)
          </button>
        )}
      </Card>
    </>
  )
}
