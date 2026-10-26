import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { LeagueActivity, PendingTrade } from '../../types/activity'
import { useMyTeam } from '../../context/MyTeamContext'
import { myTeamRowClass } from '../../myTeam/display'
import PlayerNameLink from '../PlayerNameLink'
import { formatCountdown } from '../../utils/leagueActivity'
import type { TradePreset } from '../../hooks/useTradeState'
import { Pill, SIDE_PANEL, SideDot } from './shared'
import { teamAbbrev, teamLookup, teamName, type TeamLookup } from './teams'

const WEEK_MS = 6 * 24 * 3600_000

// "Mon 10:57 AM" within a few days of now (short enough for a phone column), else "Oct 26, 10:57 AM".
const when = (iso: string | null, now: number) => {
  if (!iso) return '—'
  const d = new Date(iso)
  const near = Math.abs(d.getTime() - now) < WEEK_MS
  return d.toLocaleString('en-US', near
    ? { weekday: 'short', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Re-render every minute so the countdowns stay current.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function Step({ label, value, note, done }: { label: string; value: string; note?: string; done: boolean }) {
  return (
    <div className={`min-w-0 border-t-[3px] pt-2 ${done ? 'border-blue-600 dark:border-blue-400' : 'border-dashed border-gray-300 dark:border-gray-600'}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="text-sm font-semibold text-gray-900 tabular-nums dark:text-gray-100">{value}</div>
      {note && <div className="text-xs text-gray-500 dark:text-gray-400">{note}</div>}
    </div>
  )
}

// The analyzer compares what each team gives up, so each team's players are
// the ones the other side receives. Rosters still hold them until the trade
// processes, which is why only pending trades get a preview.
function tradePreset(trade: PendingTrade, teams: TeamLookup): TradePreset | null {
  if (trade.sides.length !== 2) return null
  const [a, b] = trade.sides
  const toPlayers = (side: typeof a) => side.received.map(p => ({ player_name: p.name, player_id: p.player_id }))
  return {
    teamA: { team_id: a.team_id, team_name: teamName(teams, a.team_id) },
    teamB: { team_id: b.team_id, team_name: teamName(teams, b.team_id) },
    playersA: toPlayers(b),
    playersB: toPlayers(a),
  }
}

function PendingTradeCard({ trade, teams, now }: { trade: PendingTrade; teams: TeamLookup; now: number }) {
  const { isMyTeam } = useMyTeam()
  const mine = trade.sides.some(s => isMyTeam(s.team_id))
  const left = trade.processes_at ? new Date(trade.processes_at).getTime() - now : null
  const other = trade.sides.find(s => s.team_id !== trade.proposed_by)
  const preset = tradePreset(trade, teams)

  return (
    <li className={`space-y-4 rounded-lg bg-white p-4 shadow-md dark:bg-gray-800 ${myTeamRowClass(mine)}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {trade.sides.map(s => teamAbbrev(teams, s.team_id)).join(' ⇄ ')}
        </h2>
        {left !== null && <Pill tone="warn">Processes {formatCountdown(left)}</Pill>}
        {preset && (
          <Link
            to="/trade"
            state={{ tradePreset: preset }}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-blue-600 px-3 text-sm font-medium text-blue-700 hover:bg-blue-50 sm:ml-auto sm:min-h-9 sm:w-auto dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/50"
          >
            Preview in Trade Analyzer
          </Link>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {trade.sides.map((s, i) => (
          <div key={s.team_id} className={`rounded-lg p-3 ${SIDE_PANEL[i % 2]}`}>
            <div className="text-xs text-gray-600 dark:text-gray-300">
              <SideDot side={(i % 2) as 0 | 1} />
              {teamName(teams, s.team_id)} ({teamAbbrev(teams, s.team_id)}) gets
            </div>
            <ul className="mt-1 space-y-0.5">
              {s.received.length === 0 ? (
                <li className="text-sm text-gray-500 dark:text-gray-400">Nothing</li>
              ) : (
                s.received.map(p => (
                  <li key={p.player_id} className="text-base font-semibold text-gray-900 dark:text-gray-100">
                    <PlayerNameLink name={p.name} playerId={p.player_id} className="hover:underline" />
                  </li>
                ))
              )}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Step
          label="Proposed"
          value={when(trade.proposed_at, now)}
          note={trade.proposed_by != null ? `by ${teamAbbrev(teams, trade.proposed_by)}` : undefined}
          done
        />
        <Step label="Accepted" value={when(trade.accepted_at, now)} note={other ? `by ${teamAbbrev(teams, other.team_id)}` : undefined} done />
        <Step label="League review" value={`${trade.approvals} approve · ${trade.vetoes} veto`} done={trade.approvals + trade.vetoes > 0} />
        <Step label="Processes" value={when(trade.processes_at, now)} note={left !== null ? formatCountdown(left) : undefined} done={false} />
      </div>
    </li>
  )
}

const PendingTradesTab = ({ activity }: { activity: LeagueActivity }) => {
  const teams = useMemo(() => teamLookup(activity.teams), [activity.teams])
  const now = useNow()
  const pending = activity.pending_trades ?? []

  if (pending.length === 0) {
    return (
      <div className="rounded-lg bg-white p-6 text-center text-sm text-gray-500 shadow-md dark:bg-gray-800 dark:text-gray-400">
        No pending trades. Accepted trades show up here during the league&apos;s review period, then move to the Trades tab once they process.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-sm text-gray-600 dark:text-gray-300">
        Accepted trades waiting out the league&apos;s review period. Nothing has moved yet: values and the trade tree
        appear in the Trades tab once a trade processes.
      </p>
      <ul className="space-y-3">
        {pending.map(t => (
          <PendingTradeCard key={t.id} trade={t} teams={teams} now={now} />
        ))}
      </ul>
    </div>
  )
}

export default PendingTradesTab
