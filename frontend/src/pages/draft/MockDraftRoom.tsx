import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useGetAdpQuery } from '../../store/api/fantasyApi'
import { useDebounce } from '../../hooks/useDebounce'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import PositionPills from '../../components/draft/PositionPills'
import {
  LAST_YEAR_COLS,
  annotateDraftPicks,
  draftTeamColor,
  draftTeamForPick,
  formatLastYearStat,
  groupDraftPicksByTeam,
  hydrateAdpPlayer,
  threeRrDisplayRounds,
  type DraftBoardPick,
} from '../../utils/adp'
import {
  groupedMoveDestinations,
  isMockComplete,
  isUserOnTheClock,
  nextPickNumber,
  takenIds,
  teamLabel,
  teamOnTheClock,
  totalPicks,
  type MockSession,
  type MockSessionPlayer,
} from '../../utils/mockDraft'
import type { AdpIndexPlayer, AdpPlayer, LastYearStats } from '../../types/api'

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
const TOAST_MS = 5000
type StatsFrom = 'actual' | 'projection'
type RoomTab = 'players' | 'history' | 'board'
type PickToast = {
  id: number
  pick: number
  team: number
  playerName: string
  fromQueue: boolean
}
type BoardShowBy = 'round' | 'team'

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
      <path d="M2.695 14.763c.083-.31.21-.6.378-.859l8.368-12.18a1.75 1.75 0 012.526-.391l1.698 1.312a1.75 1.75 0 01.391 2.526l-8.368 12.18a2.75 2.75 0 01-1.247.86l-3.206.98a.75.75 0 01-.94-.94l.98-3.206z" />
    </svg>
  )
}

function asIndex(player: MockSessionPlayer): AdpIndexPlayer {
  return {
    id: player.id,
    espn_id: player.espn_id,
    name: player.name,
    team_abbr: player.team_abbr,
    positions: player.positions,
    blend: null,
    blend_rank: null,
    ranking_blend: null,
    ranking_blend_rank: null,
  }
}

const ADP_IDS_CAP = 120

function espnHeadshotUrl(espnId: number | null | undefined): string | null {
  if (espnId == null || espnId <= 0) return null
  return `https://a.espncdn.com/i/headshots/nba/players/full/${espnId}.png`
}

function playerPhotoUrl(player: { photo_url?: string | null; espn_id: number | null }): string | null {
  return player.photo_url || espnHeadshotUrl(player.espn_id)
}

function BoardCard({ entry, userTeam }: { entry: DraftBoardPick<AdpPlayer>; userTeam: number }) {
  const { player: p, pick, team, round, pickInRound } = entry
  return (
    <div className={`rounded-md border p-2 ${draftTeamColor(team - 1)}`}>
      <div className="text-[10px] text-gray-600 dark:text-gray-300 mb-1 leading-tight">
        {teamLabel(team, userTeam)} · #{pick}
        <div>
          Round {round}, pick {pickInRound}
        </div>
      </div>
      <PlayerIdentityCell
        name={p.name}
        playerId={p.espn_id}
        photoUrl={playerPhotoUrl(p)}
        teamAbbr={p.team_abbr}
        positions={p.positions}
        wrapName
      />
    </div>
  )
}

function DraftBoardGrid({
  showBy,
  boardTeams,
  boardRounds,
  userTeam,
}: {
  showBy: BoardShowBy
  boardTeams: { team: number; picks: DraftBoardPick<AdpPlayer>[] }[]
  boardRounds: DraftBoardPick<AdpPlayer>[][]
  userTeam: number
}) {
  if (boardTeams.every((group) => group.picks.length === 0)) {
    return <p className="px-4 py-6 text-sm text-gray-400">No picks yet.</p>
  }
  return (
    <div className="p-3 space-y-4 max-h-[70vh] overflow-auto">
      {showBy === 'team'
        ? boardTeams.map((group) => (
            <div key={group.team}>
              <div
                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-t-md ${draftTeamColor(group.team - 1)}`}
              >
                {teamLabel(group.team, userTeam)}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 p-2 border border-t-0 border-gray-200 dark:border-gray-700 rounded-b-md">
                {group.picks.map((entry) => (
                  <BoardCard key={`${entry.pick}-${entry.player.id}`} entry={entry} userTeam={userTeam} />
                ))}
              </div>
            </div>
          ))
        : boardRounds.map((round, i) => (
            <div key={i}>
              <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Round {i + 1}</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {round.map((entry) => (
                  <BoardCard key={`${entry.pick}-${entry.player.id}`} entry={entry} userTeam={userTeam} />
                ))}
              </div>
            </div>
          ))}
    </div>
  )
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

export default function MockDraftRoom({
  session,
  secondsLeft,
  paused,
  onDraft,
  onMoveRoster,
  onSimToPick,
  onPause,
  onResume,
  onLeave,
}: {
  session: MockSession
  secondsLeft: number | null
  paused: boolean
  onDraft: (playerId: string) => void
  onMoveRoster: (fromIndex: number, toIndex: number) => void
  onSimToPick: () => void
  onPause: () => void
  onResume: () => void
  onLeave: () => void
}) {
  const done = isMockComplete(session)
  const userTurn = isUserOnTheClock(session)
  const onClock = teamOnTheClock(session)
  const pickNow = nextPickNumber(session)
  const total = totalPicks(session)
  const taken = takenIds(session)
  const currentRef = useRef<HTMLDivElement | null>(null)
  const [viewTeam, setViewTeam] = useState(session.userTeam)
  const [moveFrom, setMoveFrom] = useState<number | null>(null)
  const [tab, setTab] = useState<RoomTab>('players')
  const [showBy, setShowBy] = useState<BoardShowBy>('round')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [posFilter, setPosFilter] = useState<string | 'all'>('all')
  const [teamFilter, setTeamFilter] = useState('')
  const [statsFrom, setStatsFrom] = useState<StatsFrom>('projection')
  const [queue, setQueue] = useState<string[]>([])
  const queueRef = useRef<string[]>([])
  queueRef.current = queue
  const [toasts, setToasts] = useState<PickToast[]>([])
  const seenPicks = useRef(0)
  const wasUserTurn = useRef(false)
  const toastTimers = useRef<number[]>([])

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [session.picks.length])

  useEffect(() => {
    if (done) setTab('board')
  }, [done])

  useEffect(() => {
    if (userTurn && !done && !wasUserTurn.current) setTab('players')
    wasUserTurn.current = userTurn
  }, [userTurn, done])

  useEffect(() => {
    setMoveFrom(null)
  }, [viewTeam])

  useEffect(() => {
    const prev = seenPicks.current
    const added = session.picks.slice(prev)
    seenPicks.current = session.picks.length
    if (!added.length) return
    const queued = new Set(queueRef.current)
    const nextToasts = added.map((pk) => ({
      id: pk.pick,
      pick: pk.pick,
      team: pk.team,
      playerName: session.players[pk.playerId]?.name ?? 'a player',
      fromQueue: pk.team !== session.userTeam && queued.has(pk.playerId),
    }))
    const takenNow = new Set(added.map((pk) => pk.playerId))
    setQueue((cur) => cur.filter((id) => !takenNow.has(id)))
    setToasts((cur) => [...cur, ...nextToasts])
    for (const toast of nextToasts) {
      const timer = window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== toast.id))
      }, TOAST_MS)
      toastTimers.current.push(timer)
    }
  }, [session.picks, session.players, session.userTeam])

  useEffect(
    () => () => {
      for (const timer of toastTimers.current) window.clearTimeout(timer)
    },
    [],
  )

  const nbaTeams = useMemo(() => {
    const set = new Set<string>()
    for (const player of Object.values(session.players)) {
      if (player.team_abbr) set.add(player.team_abbr)
    }
    return [...set].sort()
  }, [session.players])

  const userRank = useMemo(() => {
    const map = new Map<string, number>()
    session.userOrder.forEach((id, i) => map.set(id, i + 1))
    return map
  }, [session.userOrder])

  const adpRank = useMemo(() => {
    const map = new Map<string, number>()
    session.defaultOrder.forEach((id, i) => map.set(id, i + 1))
    return map
  }, [session.defaultOrder])

  const pickByPlayer = useMemo(() => {
    const map = new Map<string, (typeof session.picks)[number]>()
    for (const pk of session.picks) map.set(pk.playerId, pk)
    return map
  }, [session.picks])

  const queuedPlayers = useMemo(
    () =>
      queue
        .map((id) => session.players[id])
        .filter((p): p is MockSessionPlayer => Boolean(p) && !taken.has(p.id)),
    [queue, session.players, taken],
  )
  const suggested = queuedPlayers[0]
  const queuedSet = useMemo(() => new Set(queue), [queue])
  const isSearching = debouncedSearch.trim().length > 0

  const listed = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase()
    const ids = q ? session.defaultOrder : session.userOrder
    return ids
      .map((id) => session.players[id])
      .filter((p): p is MockSessionPlayer => Boolean(p))
      .filter((p) => {
        if (!q && taken.has(p.id)) return false
        if (q && !p.name.toLowerCase().includes(q)) return false
        if (teamFilter && p.team_abbr !== teamFilter) return false
        if (posFilter !== 'all' && !p.positions.includes(posFilter)) return false
        return true
      })
  }, [session.defaultOrder, session.userOrder, session.players, taken, debouncedSearch, teamFilter, posFilter])

  const hydrateIds = listed.slice(0, 80).map((p) => p.id)
  const { data: details } = useGetAdpQuery({ ids: hydrateIds.join(',') }, { skip: hydrateIds.length === 0 })
  const draftedIds = useMemo(() => session.picks.map((pk) => pk.playerId), [session.picks])
  const draftedBatchA = draftedIds.slice(0, ADP_IDS_CAP).join(',')
  const draftedBatchB = draftedIds.slice(ADP_IDS_CAP, ADP_IDS_CAP * 2).join(',')
  const { data: draftedA } = useGetAdpQuery({ ids: draftedBatchA }, { skip: !draftedBatchA })
  const { data: draftedB } = useGetAdpQuery({ ids: draftedBatchB }, { skip: !draftedBatchB })
  const detailsById = useMemo(() => {
    const map = new Map<string, AdpPlayer>()
    for (const player of [...(details?.players ?? []), ...(draftedA?.players ?? []), ...(draftedB?.players ?? [])]) {
      map.set(player.id, player)
    }
    return map
  }, [details, draftedA, draftedB])

  const roster = session.rosters[viewTeam] ?? []
  const filled = roster.filter((s) => s.player).length
  const canEditRoster = viewTeam === session.userTeam

  const boardPicks = useMemo(() => {
    const ordered = session.picks.map((pk) => hydrateAdpPlayer(asIndex(session.players[pk.playerId]), detailsById.get(pk.playerId)))
    return annotateDraftPicks(ordered, session.teams, session.threeRr).map((entry, i) => {
      const pk = session.picks[i]
      return pk ? { ...entry, pick: pk.pick, team: pk.team, round: pk.round, pickInRound: pk.pickInRound } : entry
    })
  }, [session, detailsById])
  const boardRounds = useMemo(() => threeRrDisplayRounds(boardPicks, session.teams), [boardPicks, session.teams])
  const boardTeams = useMemo(() => groupDraftPicksByTeam(boardPicks, session.teams), [boardPicks, session.teams])

  const clockTitle = done
    ? 'Draft complete'
    : userTurn
      ? 'You’re on the clock'
      : `Drafting: ${onClock != null ? teamLabel(onClock, session.userTeam) : '—'}`

  return (
    <div className="relative flex flex-col gap-3">
      {paused ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/70 px-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="text-sm font-semibold uppercase tracking-widest text-white/70">Mock draft paused</div>
            {!done && onClock != null ? (
              <div className="text-white text-lg font-semibold">
                Round {Math.floor((pickNow - 1) / session.teams) + 1} · Pick {pickNow}
                <span className="block mt-1 text-base font-medium text-white/80">
                  {userTurn ? 'You are on the clock' : `${teamLabel(onClock, session.userTeam)} is on the clock`}
                </span>
              </div>
            ) : null}
            {secondsLeft != null ? (
              <div className="text-white tabular-nums text-xl font-bold">{formatClock(secondsLeft)} left on the clock</div>
            ) : null}
            <button
              type="button"
              onClick={onResume}
              className="px-12 py-5 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white text-3xl font-extrabold shadow-2xl"
            >
              Resume
            </button>
            <button type="button" onClick={onLeave} className="text-sm font-semibold text-white/70 hover:text-white">
              Leave Draft Room
            </button>
          </div>
        </div>
      ) : null}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-blue-700 text-white text-sm font-semibold">
          <span>
            Mock draft · {session.teams}-team{session.threeRr ? ', 3RR' : ' snake'} · {session.rounds} rounds
          </span>
          <div className="flex items-center gap-2">
            {session.botDelaySec > 0 && !userTurn && !done && !paused ? (
              <button
                type="button"
                onClick={onSimToPick}
                className="px-2 py-1 rounded text-xs font-semibold bg-white text-blue-800 hover:bg-blue-50"
              >
                Sim to my pick
              </button>
            ) : null}
            {!done ? (
              <button
                type="button"
                onClick={onPause}
                className="px-2 py-1 rounded text-xs font-semibold bg-white/15 hover:bg-white/25"
              >
                Pause
              </button>
            ) : null}
            <button
              type="button"
              onClick={onLeave}
              className="px-2 py-1 rounded text-xs font-semibold bg-white/15 hover:bg-white/25"
            >
              Leave Draft Room
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-stretch gap-0 border-b border-gray-200 dark:border-gray-700">
          <div
            className={`px-4 py-3 min-w-[10rem] ${
              userTurn && !done ? 'bg-blue-600 text-white' : 'bg-gray-900 text-white'
            }`}
          >
            <div
              className={`text-[10px] uppercase tracking-wide font-bold ${
                userTurn && !done ? 'text-blue-100' : 'text-gray-400'
              }`}
            >
              {clockTitle}
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {secondsLeft != null && !done ? formatClock(secondsLeft) : done ? '—' : userTurn && session.userClockSec === 0 ? '∞' : '—'}
            </div>
          </div>
          <div className="flex-1 overflow-x-auto">
            <div className="flex min-w-max">
              {Array.from({ length: total }, (_, i) => {
                const pick = i + 1
                const team = draftTeamForPick(pick, session.teams, session.threeRr)
                const made = session.picks[i]
                const current = !done && pick === pickNow
                const roundStart = (pick - 1) % session.teams === 0
                return (
                  <div key={pick} className="flex">
                    {roundStart ? (
                      <div className="flex items-center justify-center w-14 shrink-0 text-[10px] font-bold uppercase text-gray-500 border-r border-gray-200 dark:border-gray-700">
                        R{Math.floor((pick - 1) / session.teams) + 1}
                      </div>
                    ) : null}
                    <div
                      ref={current ? currentRef : undefined}
                      className={`w-28 shrink-0 px-2 py-2 border-r border-gray-200 dark:border-gray-700 ${
                        current && userTurn
                          ? 'bg-blue-600 text-white'
                          : current
                            ? 'bg-blue-100 dark:bg-blue-900'
                            : team === session.userTeam
                              ? 'bg-blue-50 dark:bg-blue-950/40'
                              : ''
                      }`}
                    >
                      <div
                        className={`text-[10px] font-semibold ${
                          current && userTurn ? 'text-blue-100' : 'text-gray-500'
                        }`}
                      >
                        PICK {pick}
                      </div>
                      <div className="text-xs font-semibold truncate">{teamLabel(team, session.userTeam)}</div>
                      <div
                        className={`text-[11px] truncate ${
                          current && userTurn ? 'text-blue-100' : 'text-gray-500'
                        }`}
                      >
                        {made
                          ? session.players[made.playerId]?.name ?? 'Picked'
                          : current
                            ? userTurn
                              ? 'Your pick'
                              : 'On the clock'
                            : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {userTurn && !done ? (
        <div className="rounded-lg border-2 border-blue-600 bg-blue-50 dark:bg-blue-950 dark:border-blue-400 px-4 py-3 text-center">
          <div className="text-lg font-extrabold text-blue-900 dark:text-blue-100 tracking-wide">
            You’re on the clock — make your pick
          </div>
          <div className="text-sm font-medium text-blue-700 dark:text-blue-200">
            Round {Math.floor((pickNow - 1) / session.teams) + 1} · Pick {pickNow} — select a player and hit Draft
          </div>
          {suggested ? (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm">
              <span className="font-semibold text-blue-900 dark:text-blue-100">
                Suggested from your queue: {suggested.name}
                {queuedPlayers.length > 1 ? (
                  <span className="font-medium text-blue-700 dark:text-blue-200">
                    {' '}
                    · {queuedPlayers.length - 1} more
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => onDraft(suggested.id)}
                className="px-2.5 py-1 rounded text-xs font-bold bg-blue-600 text-white ring-2 ring-blue-300 shadow-md"
              >
                Draft {suggested.name.split(' ').slice(-1)[0]}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col lg:flex-row gap-3 items-start">
        <aside className="w-full lg:w-72 shrink-0 card overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
            <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Roster</label>
            <select
              value={viewTeam}
              onChange={(e) => setViewTeam(Number(e.target.value))}
              className="mt-1 w-full text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5"
            >
              {Array.from({ length: session.teams }, (_, i) => i + 1).map((team) => (
                <option key={team} value={team}>
                  {teamLabel(team, session.userTeam)}
                </option>
              ))}
            </select>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-gray-400">
                <th className="text-left px-3 py-1 font-semibold">Slot</th>
                <th className="text-left px-1 py-1 font-semibold">Player</th>
                <th className="text-left px-2 py-1 font-semibold">Pos</th>
                <th className="w-7 p-0" />
              </tr>
            </thead>
            <tbody>
              {roster.map((row, i) => {
                const dests = canEditRoster ? groupedMoveDestinations(roster, i) : []
                const canMove = dests.length > 0
                const isEditing = moveFrom === i
                return (
                  <Fragment key={`${row.slot}-${i}`}>
                    <tr className={`border-t border-gray-100 dark:border-gray-800 ${isEditing ? 'bg-blue-50 dark:bg-blue-950/40' : ''}`}>
                      <td className="px-3 py-1.5 font-semibold text-xs w-12">{row.slot}</td>
                      <td className="px-1 py-1.5 text-xs">
                        {row.player ? (
                          <span className="font-medium text-gray-800 dark:text-gray-100">{row.player.name}</span>
                        ) : (
                          <span className="text-gray-400">Empty</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {row.player ? (
                          <PositionPills positions={row.player.positions} nowrap />
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="pr-2 py-1.5 w-7 text-right">
                        {canMove && row.player ? (
                          <button
                            type="button"
                            aria-label={`Move ${row.player.name}`}
                            aria-expanded={isEditing}
                            onClick={() => setMoveFrom((cur) => (cur === i ? null : i))}
                            className={`inline-flex p-0.5 rounded ${
                              isEditing
                                ? 'text-white bg-blue-600'
                                : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950'
                            }`}
                          >
                            <PencilIcon />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {isEditing && row.player ? (
                      <tr className="bg-blue-50 dark:bg-blue-950/40">
                        <td colSpan={4} className="px-3 pb-2.5 pt-0">
                          <div className="rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 px-2.5 py-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
                              Move to
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {dests.map((dest) => (
                                <button
                                  key={dest.slot}
                                  type="button"
                                  onClick={() => {
                                    onMoveRoster(i, dest.toIndex)
                                    setMoveFrom(null)
                                  }}
                                  className="px-2 py-1 rounded-md text-[11px] font-bold border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100 hover:border-blue-500 hover:bg-blue-600 hover:text-white"
                                >
                                  {dest.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-200 dark:border-gray-700">
            {filled}/{session.rounds} players
          </div>
        </aside>

        <div className="flex-1 min-w-0 card overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            {(
              [
                ['players', 'Players'],
                ['history', 'Pick history'],
                ['board', 'Draft board'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`px-2 py-1 rounded text-xs font-semibold border ${
                  tab === key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
            {tab === 'board'
              ? (['round', 'team'] as BoardShowBy[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setShowBy(mode)}
                    className={`px-2 py-1 rounded text-xs font-semibold border ${
                      showBy === mode
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {mode === 'round' ? 'Round' : 'Team'}
                  </button>
                ))
              : null}
            {userTurn && !done ? (
              <span className="ml-auto px-2 py-1 rounded text-xs font-extrabold uppercase tracking-wide bg-blue-600 text-white">
                Your pick
              </span>
            ) : null}
          </div>
          {queuedPlayers.length > 0 ? (
            <div className="px-4 py-2 border-b border-blue-100 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30">
              <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300 font-semibold">
                Queue · {queuedPlayers.length}
              </div>
              <ol className="mt-1.5 flex flex-wrap gap-1.5">
                {queuedPlayers.map((player, i) => (
                  <li
                    key={player.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 px-2 py-1 text-xs"
                  >
                    <span className="tabular-nums font-extrabold text-blue-700 dark:text-blue-300">{i + 1}</span>
                    <span className="font-semibold text-gray-800 dark:text-gray-100">{player.name}</span>
                    {player.team_abbr ? (
                      <span className="text-[10px] font-semibold text-gray-400">{player.team_abbr}</span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${player.name} from queue`}
                      onClick={() => setQueue((cur) => cur.filter((id) => id !== player.id))}
                      className="ml-0.5 w-4 h-4 rounded text-[11px] font-bold leading-none flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {tab === 'history' ? (
            <ol className="max-h-[70vh] overflow-auto divide-y divide-gray-100 dark:divide-gray-800">
              {session.picks.length === 0 ? (
                <li className="px-4 py-6 text-sm text-gray-400">No picks yet.</li>
              ) : (
                [...session.picks].reverse().map((pk) => {
                  const player = session.players[pk.playerId]
                  const full = player ? detailsById.get(player.id) : undefined
                  return (
                    <li key={pk.pick} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className="w-10 shrink-0 text-xs font-semibold text-gray-400">#{pk.pick}</span>
                      <span className="w-28 shrink-0 text-xs text-gray-500">
                        Round {pk.round}, pick {pk.pickInRound}
                      </span>
                      <span className="w-24 shrink-0 text-xs text-gray-500">{teamLabel(pk.team, session.userTeam)}</span>
                      {player ? (
                        <div className="min-w-0 flex-1">
                          <PlayerIdentityCell
                            name={player.name}
                            playerId={player.espn_id}
                            photoUrl={full?.photo_url || espnHeadshotUrl(player.espn_id)}
                            teamAbbr={player.team_abbr}
                            positions={player.positions}
                          />
                        </div>
                      ) : (
                        <span className="font-medium">{pk.playerId}</span>
                      )}
                    </li>
                  )
                })
              )}
            </ol>
          ) : tab === 'board' ? (
            <DraftBoardGrid
              showBy={showBy}
              boardTeams={boardTeams}
              boardRounds={boardRounds}
              userTeam={session.userTeam}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                <select
                  value={posFilter}
                  onChange={(e) => setPosFilter(e.target.value)}
                  className="text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
                >
                  <option value="all">All pos.</option>
                  {POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
                >
                  <option value="">All NBA teams</option>
                  {nbaTeams.map((abbr) => (
                    <option key={abbr} value={abbr}>
                      {abbr}
                    </option>
                  ))}
                </select>
                <select
                  value={statsFrom}
                  onChange={(e) => setStatsFrom(e.target.value as StatsFrom)}
                  className="text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
                >
                  <option value="projection">Projected</option>
                  <option value="actual">Last year</option>
                </select>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search players"
                  className="ml-auto text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1 w-48"
                />
              </div>
              <div className="overflow-auto max-h-[70vh]">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-[10px] uppercase text-gray-500">
                    <tr>
                      <th className="text-left px-2 py-2">Rk</th>
                      <th className="text-left px-2 py-2">Player</th>
                      <th className="px-2 py-2" />
                      {LAST_YEAR_COLS.map((col) => (
                        <th key={col.key} className="text-right px-2 py-2 hidden lg:table-cell">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((player) => {
                      const full = detailsById.get(player.id)
                      const stats: LastYearStats | null | undefined =
                        statsFrom === 'projection' ? full?.projection : full?.last_year
                      const made = pickByPlayer.get(player.id)
                      const inQueue = queuedSet.has(player.id)
                      const isSuggested = suggested?.id === player.id
                      return (
                        <tr
                          key={player.id}
                          className={`border-t border-gray-100 dark:border-gray-800 ${
                            made
                              ? 'opacity-70'
                              : inQueue
                                ? `bg-blue-50 dark:bg-blue-950/40 ${isSuggested && userTurn ? 'border-l-4 border-l-blue-600' : 'border-l-4 border-l-blue-400'}`
                                : ''
                          }`}
                        >
                          <td className="px-2 py-2 tabular-nums text-xs text-gray-500">
                            {isSearching ? adpRank.get(player.id) : userRank.get(player.id)}
                          </td>
                          <td className="px-2 py-2 min-w-[12rem]">
                            <PlayerIdentityCell
                              name={player.name}
                              playerId={player.espn_id}
                              photoUrl={full?.photo_url || espnHeadshotUrl(player.espn_id)}
                              teamAbbr={player.team_abbr}
                              positions={player.positions}
                            />
                          </td>
                          <td className="px-2 py-2">
                            {made ? (
                              <span className="inline-block text-[11px] font-semibold text-gray-600 dark:text-gray-300">
                                Drafted · {teamLabel(made.team, session.userTeam)} · #{made.pick}
                              </span>
                            ) : (
                              <div className="flex items-center gap-3">
                                <button
                                  type="button"
                                  disabled={!userTurn}
                                  onClick={() => onDraft(player.id)}
                                  className={`px-2 py-1 rounded text-xs font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed ${
                                    userTurn ? 'ring-2 ring-blue-300 shadow-md' : ''
                                  }`}
                                >
                                  Draft
                                </button>
                                <button
                                  type="button"
                                  aria-label={inQueue ? `Remove ${player.name} from queue` : `Add ${player.name} to queue`}
                                  aria-pressed={inQueue}
                                  onClick={() =>
                                    setQueue((cur) =>
                                      cur.includes(player.id)
                                        ? cur.filter((id) => id !== player.id)
                                        : [...cur, player.id],
                                    )
                                  }
                                  className={`w-7 h-7 rounded text-sm font-bold leading-none flex items-center justify-center ${
                                    inQueue
                                      ? 'bg-blue-600 text-white'
                                      : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                                  }`}
                                >
                                  {inQueue ? '−' : '+'}
                                </button>
                              </div>
                            )}
                          </td>
                          {LAST_YEAR_COLS.map((col) => (
                            <td key={col.key} className="text-right px-2 py-2 tabular-nums text-xs hidden lg:table-cell">
                              {formatLastYearStat(stats?.[col.key], col.pct, col.whole)}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {listed.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-gray-400">
                    {isSearching ? 'No players match that name.' : 'No remaining players match those filters.'}
                  </p>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {toasts.length > 0 ? (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end max-h-[70vh] overflow-y-auto pointer-events-auto">
          {toasts.map((toast) => {
            const yours = toast.team === session.userTeam
            return (
              <div
                key={toast.id}
                className={`pointer-events-auto overflow-hidden rounded-lg shadow-xl max-w-xs w-72 ${
                  yours
                    ? 'bg-blue-600 text-white'
                    : toast.fromQueue
                      ? 'bg-amber-900 text-white border border-amber-500'
                      : 'bg-gray-900 text-white border border-gray-700'
                }`}
              >
                <div className="px-4 py-3 text-sm font-semibold">
                  {teamLabel(toast.team, session.userTeam)} picked {toast.playerName}
                  {toast.fromQueue ? (
                    <div className="mt-1 text-xs font-medium text-amber-200">Taken from your queue</div>
                  ) : null}
                </div>
                <div className={`h-1 w-full ${yours ? 'bg-blue-800' : toast.fromQueue ? 'bg-amber-950' : 'bg-black/40'}`}>
                  <div
                    className={`h-full origin-left ${yours ? 'bg-white' : 'bg-blue-400'}`}
                    style={{ animation: `toast-timer-shrink ${TOAST_MS}ms linear forwards` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
