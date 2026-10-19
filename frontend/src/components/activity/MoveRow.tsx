import { Link } from 'react-router'
import type { ActivityMove } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import { MyTeamMark, myTeamRowClass } from '../MyTeamMark'
import PlayerNameLink from '../PlayerNameLink'
import { KindPill } from './shared'
import { teamAbbrev, type TeamLookup } from './teams'

interface MoveRowProps {
  move: ActivityMove
  teams: TeamLookup
  // Left column: time of day in the full feed, the date in the compact card.
  when: string
  compact?: boolean
}

const MoveRow = ({ move, teams, when, compact = false }: MoveRowProps) => {
  const { isMyTeam } = useMyTeam()
  const mine = isMyTeam(move.team_id) || isMyTeam(move.other_team_id)
  const isTrade = move.kind === 'trade'

  const who = isTrade ? (
    <span className="font-semibold text-gray-900 dark:text-gray-100">
      {teamAbbrev(teams, move.team_id)} ⇄ {teamAbbrev(teams, move.other_team_id ?? 0)}
    </span>
  ) : (
    <span className="font-semibold text-gray-900 dark:text-gray-100">{teamAbbrev(teams, move.team_id)}</span>
  )

  const what = isTrade ? (
    <>
      <Link
        to={`/activity?tab=trades&trade=${encodeURIComponent(move.trade_id ?? move.id)}`}
        className="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800 hover:underline dark:bg-blue-950 dark:text-blue-300"
      >
        Trade
      </Link>
      <span className="text-gray-700 dark:text-gray-300">
        <b>{teamAbbrev(teams, move.team_id)}</b> got {move.added.map(p => p.name).join(', ') || 'nothing'}
      </span>
      <span className="text-gray-700 dark:text-gray-300">
        <b>{teamAbbrev(teams, move.other_team_id ?? 0)}</b> got {move.dropped.map(p => p.name).join(', ') || 'nothing'}
      </span>
    </>
  ) : (
    <>
      <KindPill kind={move.kind} />
      {move.added.map(p => (
        <span key={`a${p.player_id}`} className="text-emerald-700 dark:text-emerald-400">
          +{' '}
          <PlayerNameLink name={p.name} playerId={p.player_id} className="-my-1 inline-block py-1 hover:underline" />
        </span>
      ))}
      {move.dropped.map(p => (
        <span key={`d${p.player_id}`} className="text-gray-500 dark:text-gray-400">
          −{' '}
          <PlayerNameLink name={p.name} playerId={p.player_id} className="-my-1 inline-block py-1 hover:underline" />
        </span>
      ))}
    </>
  )

  return (
    <li
      data-mine={mine || undefined}
      className={`grid items-start gap-x-3 gap-y-1 border-b border-gray-100 px-3 py-2 text-sm last:border-b-0 dark:border-gray-700 ${
        compact ? 'grid-cols-[3.25rem_1fr]' : 'grid-cols-[4.5rem_1fr] sm:grid-cols-[4.5rem_7rem_1fr]'
      } ${mine ? `bg-blue-50 dark:bg-blue-950/40 ${myTeamRowClass(true)}` : ''}`}
    >
      <span className={`text-xs text-gray-500 tabular-nums dark:text-gray-400 ${compact ? '' : 'row-span-2 sm:row-span-1'}`}>{when}</span>
      {compact ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {who}
          {mine && <MyTeamMark teamId={isMyTeam(move.team_id) ? move.team_id : move.other_team_id} />}
          {what}
        </div>
      ) : (
        <>
          <span className="flex min-w-0 items-center">
            {who}
            <MyTeamMark teamId={isMyTeam(move.team_id) ? move.team_id : move.other_team_id} />
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{what}</div>
        </>
      )}
    </li>
  )
}

export default MoveRow
