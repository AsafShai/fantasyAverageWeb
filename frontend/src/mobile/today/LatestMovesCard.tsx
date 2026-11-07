import { Link } from 'react-router'
import { useGetLatestMovesQuery } from '../../store/api/fantasyApi'
import type { ActivityMove, MoveKind as ActivityKind } from '../../types/activity'
import { formatDay, localDay } from '../../utils/leagueActivity'
import { teamAbbrev, teamLookup, type TeamLookup } from '../../components/activity/teams'
import PlayerNameLink from '../../components/PlayerNameLink'
import { MyTeamMark } from '../../components/MyTeamMark'
import { useMyTeam } from '../../context/MyTeamContext'
import { Card } from '../ui/Card'
import { MoveKindPill, type MoveKind } from '../ui/Pills'

const LATEST_MOVES = 8

const KIND: Record<ActivityKind, { pill: MoveKind; label?: string }> = {
  add: { pill: 'added' },
  waiver: { pill: 'waiver' },
  drop: { pill: 'dropped' },
  trade_drop: { pill: 'dropped', label: 'Dropped for trade' },
  trade: { pill: 'trade' },
}

function Move({ move, teams }: { move: ActivityMove; teams: TeamLookup }) {
  const { isMyTeam } = useMyTeam()
  const mine = isMyTeam(move.team_id) || isMyTeam(move.other_team_id)
  const kind = KIND[move.kind]
  const a = teamAbbrev(teams, move.team_id)

  return (
    <li className={`mr-today-lm ${mine ? 'mr-me' : ''}`.trim()} data-mine={mine || undefined}>
      <span className="mr-today-lmd">{formatDay(localDay(move.at))}</span>
      {move.kind === 'trade' ? (
        <div className="mr-today-lmb">
          <span className="mr-today-lmh">
            <b>
              {a} ⇄ {teamAbbrev(teams, move.other_team_id ?? 0)}
            </b>
            {mine && <MyTeamMark teamId={isMyTeam(move.team_id) ? move.team_id : move.other_team_id} />}
            <Link
              to={`/activity?tab=trades&trade=${encodeURIComponent(move.trade_id ?? move.id)}`}
              className="mr-pill mr-pill-trade"
            >
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
        <div className="mr-today-lmb">
          <span className="mr-today-lmh">
            <b>{a}</b>
            {mine && <MyTeamMark teamId={move.team_id} />}
            <MoveKindPill kind={kind.pill}>{kind.label}</MoveKindPill>
            {move.added.map((p) => (
              <span key={`a${p.player_id}`} className="mr-today-add">
                + <PlayerNameLink name={p.name} playerId={p.player_id} className="mr-today-plink" />
              </span>
            ))}
          </span>
          {move.dropped.map((p) => (
            <span key={`d${p.player_id}`} className="mr-today-drop">
              − <PlayerNameLink name={p.name} playerId={p.player_id} className="mr-today-plink" />
            </span>
          ))}
        </div>
      )}
    </li>
  )
}

/** Latest adds, drops and trades, with the team abbreviation and a kind badge. */
export function LatestMovesCard() {
  const { data, isLoading, isError } = useGetLatestMovesQuery(LATEST_MOVES)
  const teams = teamLookup(data?.teams ?? [])

  return (
    <Card
      title="Latest moves"
      action={
        <Link to="/activity" className="mr-link">
          All activity →
        </Link>
      }
    >
      {isLoading ? (
        <p className="mr-meta">Loading moves…</p>
      ) : isError ? (
        <p className="mr-meta">League activity is unavailable right now.</p>
      ) : !data?.moves.length ? (
        <p className="mr-meta">No adds, drops or trades yet this season.</p>
      ) : (
        <ul className="mr-today-list">
          {data.moves.map((m) => (
            <Move key={m.id} move={m} teams={teams} />
          ))}
        </ul>
      )}
    </Card>
  )
}
