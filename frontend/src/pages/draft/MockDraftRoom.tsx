import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useGetAdpQuery } from '../../store/api/fantasyApi'
import { stablePlayerIds } from '../../utils/draftRankings'
import { useDebounce } from '../../hooks/useDebounce'
import { useIsBelowLg } from '../../hooks/useIsBelowLg'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import PositionPills from '../../components/draft/PositionPills'
import PaginationBar from '../../components/draft/PaginationBar'
import { resolvePageSize, type PageSize } from '../../utils/pagination'
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
  hasOpenSlotFor,
  isMockComplete,
  isUserOnTheClock,
  nextPickNumber,
  takenIds,
  teamLabel,
  teamOnTheClock,
  tickerPickNumbers,
  totalPicks,
  type MockSession,
  type MockSessionPlayer,
} from '../../utils/mockDraft'
import { readMockQueue, writeMockQueue } from '../../utils/mockDraftPersistence'
import type { AdpIndexPlayer, AdpPlayer, LastYearStats } from '../../types/api'
import { MockProjectedStandings } from './MockProjectedStandings'
import type { StatsFrom } from '../../utils/mockProjectedStandings'

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
const TOAST_MS = 5000
const TOAST_MAX = 10
type RoomTab = 'players' | 'roster' | 'history' | 'board' | 'standings'
type PickToast = {
  id: number
  pick: number
  team: number
  playerName: string
  fromQueue: boolean
}
type BoardShowBy = 'round' | 'team'
type PlayerSortKey = 'rk' | 'name' | (typeof LAST_YEAR_COLS)[number]['key']
type SortDir = 'asc' | 'desc'

function PlayerSortHeader({
  label,
  col,
  sortBy,
  sortDir,
  onSort,
  align = 'right',
}: {
  label: string
  col: PlayerSortKey
  sortBy: PlayerSortKey
  sortDir: SortDir
  onSort: (col: PlayerSortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortBy === col
  return (
    <th
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`p-0 font-semibold whitespace-nowrap ${align === 'left' ? 'text-left' : 'text-right'} ${
        col !== 'rk' && col !== 'name' ? 'hidden lg:table-cell' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`w-full min-h-9 px-2 py-2 inline-flex items-center gap-0.5 uppercase hover:text-gray-800 dark:hover:text-gray-200 ${
          align === 'left' ? 'justify-start' : 'justify-end'
        }`}
      >
        {label}
        <span aria-hidden className={active ? 'visible' : 'invisible'}>
          {sortDir === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </th>
  )
}

function PencilIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
      <path d="M2.695 14.763c.083-.31.21-.6.378-.859l8.368-12.18a1.75 1.75 0 012.526-.391l1.698 1.312a1.75 1.75 0 01.391 2.526l-8.368 12.18a2.75 2.75 0 01-1.247.86l-3.206.98a.75.75 0 01-.94-.94l.98-3.206z" />
    </svg>
  )
}

const MockPlayerTableRow = memo(function MockPlayerTableRow({
  player,
  rank,
  photoUrl,
  stats,
  madeLabel,
  inQueue,
  isSuggested,
  userTurn,
  canDraft,
  onDraft,
  onToggleQueue,
}: {
  player: MockSessionPlayer
  rank: number | undefined
  photoUrl: string | null
  stats: LastYearStats | null | undefined
  madeLabel: string | null
  inQueue: boolean
  isSuggested: boolean
  userTurn: boolean
  canDraft: boolean
  onDraft: (id: string) => void
  onToggleQueue: (id: string) => void
}) {
  return (
    <tr
      className={`border-t border-gray-100 dark:border-gray-800 ${
        madeLabel
          ? 'opacity-70'
          : inQueue
            ? `bg-blue-50 dark:bg-blue-950/40 ${isSuggested && userTurn ? 'border-l-4 border-l-blue-600' : 'border-l-4 border-l-blue-400'}`
            : ''
      }`}
    >
      <td className="px-2 py-2 tabular-nums text-xs text-gray-500">{rank}</td>
      <td className="px-2 py-2 min-w-[12rem]">
        <PlayerIdentityCell
          link={false}
          name={player.name}
          playerId={player.espn_id}
          photoUrl={photoUrl}
          teamAbbr={player.team_abbr}
          positions={player.positions}
        />
      </td>
      <td className="px-2 py-2">
        {madeLabel ? (
          <span className="inline-block text-[11px] font-semibold text-gray-600 dark:text-gray-300">{madeLabel}</span>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={!userTurn || !canDraft}
              title={userTurn && !canDraft ? 'No open roster spot for this player' : undefined}
              onClick={() => onDraft(player.id)}
              className={`px-2 py-1 rounded text-xs font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed ${
                userTurn && canDraft ? 'ring-2 ring-blue-300 shadow-md' : ''
              }`}
            >
              Draft
            </button>
            <button
              type="button"
              aria-label={inQueue ? `Remove ${player.name} from queue` : `Add ${player.name} to queue`}
              aria-pressed={inQueue}
              onClick={() => onToggleQueue(player.id)}
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
})

function MockCardStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-center">
      <div className="text-[9px] uppercase tracking-wide text-gray-400 leading-none">{label}</div>
      <div className="mt-0.5 tabular-nums text-[11px] text-gray-700 dark:text-gray-200 leading-tight">{value}</div>
    </div>
  )
}

const MockPlayerCard = memo(function MockPlayerCard({
  player,
  rank,
  photoUrl,
  stats,
  madePick,
  inQueue,
  isSuggested,
  userTurn,
  canDraft,
  onOpen,
  onDraft,
  onToggleQueue,
}: {
  player: MockSessionPlayer
  rank: number | undefined
  photoUrl: string | null
  stats: LastYearStats | null | undefined
  madePick: number | null
  inQueue: boolean
  isSuggested: boolean
  userTurn: boolean
  canDraft: boolean
  onOpen: (id: string) => void
  onDraft: (id: string) => void
  onToggleQueue: (id: string) => void
}) {
  return (
    <div
      className={`px-2 py-2 min-w-0 border-b border-gray-100 dark:border-gray-800 last:border-b-0 ${
        madePick != null
          ? 'opacity-70'
          : inQueue
            ? `bg-blue-50 dark:bg-blue-950/40 ${isSuggested && userTurn ? 'border-l-4 border-l-blue-600' : 'border-l-4 border-l-blue-400'}`
            : ''
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
      <div className="w-6 shrink-0 text-right tabular-nums text-xs font-semibold text-gray-500">{rank}</div>
      <button type="button" onClick={() => onOpen(player.id)} className="min-w-0 flex-1 text-left">
        <PlayerIdentityCell
          link={false}
          name={player.name}
          playerId={player.espn_id}
          photoUrl={photoUrl}
          teamAbbr={player.team_abbr}
          positions={player.positions}
          rowSelectOnMobile
        />
      </button>
      {madePick != null ? (
        <span className="shrink-0 max-w-[5.5rem] text-[11px] font-semibold text-gray-600 dark:text-gray-300 text-right leading-tight">
          #{madePick}
        </span>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={!userTurn || !canDraft}
            title={userTurn && !canDraft ? 'No open roster spot for this player' : undefined}
            onClick={() => onDraft(player.id)}
            className={`min-h-11 px-2.5 rounded-md text-xs font-bold bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed ${
              userTurn && canDraft ? 'ring-2 ring-blue-300 shadow-md' : ''
            }`}
          >
            Draft
          </button>
          <button
            type="button"
            aria-label={inQueue ? `Remove ${player.name} from queue` : `Add ${player.name} to queue`}
            aria-pressed={inQueue}
            onClick={() => onToggleQueue(player.id)}
            className={`min-h-11 min-w-11 rounded-md text-lg font-bold leading-none flex items-center justify-center ${
              inQueue
                ? 'bg-blue-600 text-white'
                : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'
            }`}
          >
            {inQueue ? '−' : '+'}
          </button>
        </div>
      )}
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-x-1 gap-y-1">
        {LAST_YEAR_COLS.map((col) => (
          <MockCardStat
            key={col.key}
            label={col.label}
            value={stats ? formatLastYearStat(stats[col.key], col.pct, col.whole) : '—'}
          />
        ))}
      </div>
    </div>
  )
})

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

function espnHeadshotUrl(espnId: number | null | undefined): string | null {
  if (espnId == null || espnId <= 0) return null
  return `https://a.espncdn.com/i/headshots/nba/players/full/${espnId}.png`
}

function playerPhotoUrl(player: { photo_url?: string | null; espn_id: number | null }): string | null {
  return player.photo_url || espnHeadshotUrl(player.espn_id)
}

function lastName(name: string): string {
  return name.split(' ').slice(-1)[0] || name
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
        link={false}
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

function ClockFace({
  deadlineMs,
  frozenSec,
  done,
  unlimited,
  className,
}: {
  deadlineMs: number | null
  frozenSec: number | null
  done: boolean
  unlimited: boolean
  className?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (deadlineMs == null || done) return
    const id = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(id)
  }, [deadlineMs, done])
  if (done) return <span className={className}>—</span>
  if (unlimited && deadlineMs == null && frozenSec == null) return <span className={className}>∞</span>
  const seconds = deadlineMs != null ? Math.max(0, (deadlineMs - now) / 1000) : frozenSec
  if (seconds == null) return <span className={className}>—</span>
  return <span className={className}>{formatClock(seconds)}</span>
}

function TickerCell({
  pick,
  session,
  pickNow,
  done,
  userTurn,
  currentRef,
}: {
  pick: number
  session: MockSession
  pickNow: number
  done: boolean
  userTurn: boolean
  currentRef?: RefObject<HTMLDivElement | null>
}) {
  const team = draftTeamForPick(pick, session.teams, session.threeRr)
  const made = session.picks[pick - 1]
  const current = !done && pick === pickNow
  const roundStart = (pick - 1) % session.teams === 0
  return (
    <div className="flex">
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
        <div className={`text-[10px] font-semibold ${current && userTurn ? 'text-blue-100' : 'text-gray-500'}`}>
          PICK {pick}
        </div>
        <div className="text-xs font-semibold truncate">{teamLabel(team, session.userTeam)}</div>
        <div className={`text-[11px] truncate ${current && userTurn ? 'text-blue-100' : 'text-gray-500'}`}>
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
}

function TickerTrack({
  session,
  pickNow,
  total,
  done,
  userTurn,
  currentRef,
  windowed = false,
}: {
  session: MockSession
  pickNow: number
  total: number
  done: boolean
  userTurn: boolean
  currentRef: RefObject<HTMLDivElement | null>
  windowed?: boolean
}) {
  const picks = useMemo(
    () => tickerPickNumbers(total, pickNow, done, windowed),
    [total, pickNow, done, windowed],
  )
  return (
    <div className="flex min-w-max">
      {picks.map((pick) => (
        <TickerCell
          key={pick}
          pick={pick}
          session={session}
          pickNow={pickNow}
          done={done}
          userTurn={userTurn}
          currentRef={currentRef}
        />
      ))}
    </div>
  )
}

function RosterPanel({
  session,
  viewTeam,
  setViewTeam,
  moveFrom,
  setMoveFrom,
  onMoveRoster,
  largeHit,
  sheetMoves,
}: {
  session: MockSession
  viewTeam: number
  setViewTeam: (team: number) => void
  moveFrom: number | null
  setMoveFrom: Dispatch<SetStateAction<number | null>>
  onMoveRoster: (from: number, to: number) => void
  largeHit: boolean
  sheetMoves: boolean
}) {
  const roster = session.rosters[viewTeam] ?? []
  const filled = roster.filter((s) => s.player).length
  const canEditRoster = viewTeam === session.userTeam
  return (
    <>
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <label className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Roster</label>
        <select
          value={viewTeam}
          onChange={(e) => setViewTeam(Number(e.target.value))}
          className={`mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 ${
            largeHit ? 'text-base min-h-11' : 'text-sm'
          }`}
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
                  <td className={`pr-2 py-1.5 text-right ${largeHit ? 'w-12' : 'w-7'}`}>
                    {canMove && row.player ? (
                      <button
                        type="button"
                        aria-label={`Move ${row.player.name}`}
                        aria-expanded={isEditing}
                        onClick={() => setMoveFrom((cur) => (cur === i ? null : i))}
                        className={`inline-flex items-center justify-center rounded ${
                          largeHit ? 'min-h-11 min-w-11' : 'p-0.5'
                        } ${
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
                {!sheetMoves && isEditing && row.player ? (
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
    </>
  )
}

function QueueBar({
  queuedPlayers,
  onRemove,
  onDraft,
  userTurn,
  canDraft,
  snap,
}: {
  queuedPlayers: MockSessionPlayer[]
  onRemove: (id: string) => void
  onDraft: (id: string) => void
  userTurn: boolean
  canDraft: (player: MockSessionPlayer) => boolean
  snap: boolean
}) {
  if (queuedPlayers.length === 0) return null
  return (
    <div className="px-4 py-2 border-b border-blue-100 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 min-w-0 w-full overflow-hidden">
      <div className="text-[10px] uppercase tracking-wide text-blue-700 dark:text-blue-300 font-semibold">
        Queue · {queuedPlayers.length}
      </div>
      <ol
        className={
          snap
            ? 'mt-1.5 flex gap-2 min-w-0 overflow-x-auto overscroll-x-contain snap-x snap-proximity pb-1 [scrollbar-width:thin]'
            : 'mt-1.5 flex flex-wrap gap-1.5'
        }
      >
        {queuedPlayers.map((player, i) => (
          <li
            key={player.id}
            className={`inline-flex items-center gap-1.5 rounded-md border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-900 px-2 text-xs shrink-0 max-w-[min(100%,16rem)] ${
              snap ? 'snap-start py-1.5' : 'py-1'
            }`}
          >
            <span className="tabular-nums font-extrabold text-blue-700 dark:text-blue-300">{i + 1}</span>
            <span className="font-semibold text-gray-800 dark:text-gray-100 truncate">{player.name}</span>
            {player.team_abbr ? (
              <span className="text-[10px] font-semibold text-gray-400 shrink-0">{player.team_abbr}</span>
            ) : null}
            <button
              type="button"
              disabled={!userTurn || !canDraft(player)}
              title={userTurn && !canDraft(player) ? 'No open roster spot for this player' : undefined}
              aria-label={`Draft ${player.name}`}
              onClick={() => onDraft(player.id)}
              className={`shrink-0 rounded bg-blue-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed ${
                snap ? 'min-h-11 px-2.5 text-xs' : 'px-1.5 py-0.5 text-[10px]'
              }`}
            >
              Draft
            </button>
            <button
              type="button"
              aria-label={`Remove ${player.name} from queue`}
              onClick={() => onRemove(player.id)}
              className={
                snap
                  ? 'ml-0.5 min-w-11 min-h-11 -my-1 shrink-0 rounded text-lg font-bold leading-none flex items-center justify-center text-gray-500 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800'
                  : 'ml-0.5 w-4 h-4 rounded text-[11px] font-bold leading-none flex items-center justify-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
              }
            >
              ×
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

function PickHistoryList({
  session,
  detailsById,
  stacked,
  ascending = false,
  className,
}: {
  session: MockSession
  detailsById: Map<string, AdpPlayer>
  stacked: boolean
  ascending?: boolean
  className?: string
}) {
  const picks = ascending ? session.picks : [...session.picks].reverse()
  const latestPick = session.picks[session.picks.length - 1]?.pick
  if (session.picks.length === 0) {
    return (
      <ol className={className ?? 'max-h-[70vh] overflow-auto'}>
        <li className="px-4 py-6 text-sm text-gray-400">No picks yet.</li>
      </ol>
    )
  }
  return (
    <ol className={className ?? 'max-h-[70vh] overflow-auto divide-y divide-gray-100 dark:divide-gray-800'}>
      {picks.map((pk) => {
        const player = session.players[pk.playerId]
        const full = player ? detailsById.get(player.id) : undefined
        if (stacked) {
          return (
            <li
              key={pk.pick}
              className={`px-4 py-3 space-y-2 ${
                ascending && pk.pick === latestPick ? 'bg-blue-50 dark:bg-blue-950/40' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-gray-500">
                <span className="font-bold tabular-nums text-gray-700 dark:text-gray-200">#{pk.pick}</span>
                <span>
                  Round {pk.round}, pick {pk.pickInRound}
                </span>
                <span>{teamLabel(pk.team, session.userTeam)}</span>
              </div>
              {player ? (
                <PlayerIdentityCell
                  link={false}
                  name={player.name}
                  playerId={player.espn_id}
                  photoUrl={full?.photo_url || espnHeadshotUrl(player.espn_id)}
                  teamAbbr={player.team_abbr}
                  positions={player.positions}
                  splitMetaOnMobile
                />
              ) : (
                <span className="font-medium">{pk.playerId}</span>
              )}
            </li>
          )
        }
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
                  link={false}
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
      })}
    </ol>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-800/80 px-2 py-2 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-800 dark:text-gray-100">{value}</div>
    </div>
  )
}

function MockPlayerSheet({
  player,
  photoUrl,
  rank,
  stats,
  statsLabel,
  userTurn,
  canDraft,
  inQueue,
  draftedLabel,
  onClose,
  onDraft,
  onToggleQueue,
}: {
  player: MockSessionPlayer
  photoUrl: string | null
  rank: number | undefined
  stats?: LastYearStats | null
  statsLabel: string
  userTurn: boolean
  canDraft: boolean
  inQueue: boolean
  draftedLabel: string | null
  onClose: () => void
  onDraft: () => void
  onToggleQueue: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-player-sheet-title"
        className="w-full max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-gray-900 shadow-xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="mock-player-sheet-title" className="sr-only">
              {player.name}
            </h2>
            <PlayerIdentityCell
              link={false}
              name={player.name}
              playerId={player.espn_id}
              photoUrl={photoUrl}
              teamAbbr={player.team_abbr}
              positions={player.positions}
              wrapName
              photoSize="full"
            />
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Rank</div>
            <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{rank ?? '—'}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 min-h-11 min-w-11 -mr-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">{statsLabel}</h3>
          <div className="grid grid-cols-4 gap-2">
            {LAST_YEAR_COLS.map((col) => (
              <StatTile
                key={col.key}
                label={col.label}
                value={stats ? formatLastYearStat(stats[col.key], col.pct, col.whole) : '—'}
              />
            ))}
          </div>
        </section>

        {draftedLabel ? (
          <p className="mt-4 text-sm font-semibold text-gray-600 dark:text-gray-300">{draftedLabel}</p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={!userTurn || !canDraft}
              title={userTurn && !canDraft ? 'No open roster spot for this player' : undefined}
              onClick={onDraft}
              className="min-h-11 px-3 text-sm font-bold rounded-md bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Draft
            </button>
            <button
              type="button"
              onClick={onToggleQueue}
              className={`min-h-11 px-3 text-sm font-bold rounded-md ${
                inQueue
                  ? 'bg-blue-600 text-white'
                  : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'
              }`}
            >
              {inQueue ? 'Remove from queue' : 'Add to queue'}
            </button>
          </div>
        )}
        {userTurn && !canDraft && !draftedLabel ? (
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">No open roster spot for this player.</p>
        ) : null}
      </div>
    </div>
  )
}

function RosterMoveSheet({
  playerName,
  dests,
  onMove,
  onClose,
}: {
  playerName: string
  dests: { toIndex: number; slot: string; label: string }[]
  onMove: (toIndex: number) => void
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="roster-move-sheet-title"
        className="w-full max-h-[70vh] overflow-y-auto rounded-t-2xl bg-white dark:bg-gray-900 shadow-xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="roster-move-sheet-title" className="text-base font-bold text-gray-900 dark:text-gray-100">
              Move {playerName}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Choose a destination slot</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 min-h-11 min-w-11 -mr-1 rounded-md text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {dests.map((dest) => (
            <button
              key={dest.slot}
              type="button"
              onClick={() => onMove(dest.toIndex)}
              className="min-h-11 px-4 rounded-md text-sm font-bold border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-100"
            >
              {dest.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function PickToasts({
  toasts,
  userTeam,
  placement,
}: {
  toasts: PickToast[]
  userTeam: number
  placement: 'desktop' | 'mobile'
}) {
  const shown = (placement === 'desktop' ? toasts.filter((t) => t.fromQueue) : toasts).slice(
    placement === 'mobile' ? -2 : -TOAST_MAX,
  )
  if (shown.length === 0) return null
  return (
    <div
      className={
        placement === 'mobile'
          ? 'fixed inset-x-6 z-50 flex flex-col gap-1 items-stretch pointer-events-none bottom-[calc(4.5rem+env(safe-area-inset-bottom)+0.5rem)]'
          : 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end max-h-[70vh] overflow-y-auto pointer-events-auto'
      }
    >
      {shown.map((toast) => {
        const yours = toast.team === userTeam
        const compact = placement === 'mobile'
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto overflow-hidden shadow-xl w-full ${
              compact ? 'rounded-md max-w-[16rem] mx-auto' : 'rounded-lg max-w-xs w-72'
            } ${
              yours
                ? 'bg-blue-600 text-white'
                : toast.fromQueue
                  ? 'bg-amber-900 text-white border border-amber-500'
                  : 'bg-gray-900 text-white border border-gray-700'
            }`}
          >
            <div className={compact ? 'px-2.5 py-1.5 text-[11px] font-semibold leading-snug' : 'px-4 py-3 text-sm font-semibold'}>
              {teamLabel(toast.team, userTeam)} picked {toast.playerName}
              {toast.fromQueue ? (
                <div className={compact ? 'mt-0.5 text-[10px] font-medium text-amber-200' : 'mt-1 text-xs font-medium text-amber-200'}>
                  Taken from your queue
                </div>
              ) : null}
            </div>
            <div className={`${compact ? 'h-0.5' : 'h-1'} w-full ${yours ? 'bg-blue-800' : toast.fromQueue ? 'bg-amber-950' : 'bg-black/40'}`}>
              <div
                className={`h-full origin-left ${yours ? 'bg-white' : 'bg-blue-400'}`}
                style={{ animation: `toast-timer-shrink ${TOAST_MS}ms linear forwards` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function MockDraftRoom({
  session,
  clockDeadlineMs,
  clockFrozenSec,
  paused,
  onDraft,
  onMoveRoster,
  onSimToPick,
  onPause,
  onResume,
  onLeave,
}: {
  session: MockSession
  clockDeadlineMs: number | null
  clockFrozenSec: number | null
  paused: boolean
  onDraft: (playerId: string) => void
  onMoveRoster: (fromIndex: number, toIndex: number) => void
  onSimToPick: () => void
  onPause: () => void
  onResume: () => void
  onLeave: () => void
}) {
  const isBelowLg = useIsBelowLg()
  const done = isMockComplete(session)
  const userTurn = isUserOnTheClock(session)
  const onClock = teamOnTheClock(session)
  const pickNow = nextPickNumber(session)
  const total = totalPicks(session)
  const taken = takenIds(session)
  const currentRef = useRef<HTMLDivElement | null>(null)
  const moreRef = useRef<HTMLDivElement | null>(null)
  const historyRailRef = useRef<HTMLDivElement | null>(null)
  const [viewTeam, setViewTeam] = useState(session.userTeam)
  const [moveFrom, setMoveFrom] = useState<number | null>(null)
  const [tab, setTab] = useState<RoomTab>('players')
  const [showBy, setShowBy] = useState<BoardShowBy>('round')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 200)
  const [posFilter, setPosFilter] = useState<string | 'all'>('all')
  const [teamFilter, setTeamFilter] = useState('')
  const [statsFrom, setStatsFrom] = useState<StatsFrom>('actual')
  const [queue, setQueue] = useState<string[]>(() => {
    const taken = takenIds(session)
    return readMockQueue().filter((id) => session.players[id] && !taken.has(id))
  })
  const queueRef = useRef<string[]>([])
  queueRef.current = queue
  const [toasts, setToasts] = useState<PickToast[]>([])
  const seenPicks = useRef(session.picks.length)
  const wasUserTurn = useRef(false)
  const toastTimers = useRef<number[]>([])
  const [moreOpen, setMoreOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(25)
  const [playerSort, setPlayerSort] = useState<PlayerSortKey>('rk')
  const [playerSortDir, setPlayerSortDir] = useState<SortDir>('asc')
  const [detailsById, setDetailsById] = useState<Map<string, AdpPlayer>>(() => new Map())

  useEffect(() => {
    writeMockQueue(queue)
  }, [queue])

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [session.picks.length])

  useEffect(() => {
    const rail = historyRailRef.current
    if (!rail) return
    rail.scrollTop = rail.scrollHeight
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
    if (!isBelowLg && (tab === 'roster' || tab === 'history')) setTab('players')
  }, [isBelowLg, tab])

  useEffect(() => {
    if (!isBelowLg) {
      setMoreOpen(false)
      setSelectedId(null)
    }
  }, [isBelowLg])

  useEffect(() => {
    const prev = seenPicks.current
    const added = session.picks.slice(prev)
    seenPicks.current = session.picks.length
    if (!added.length) return
    const queued = new Set(queueRef.current)
    const nextToasts = added
      .map((pk) => ({
        id: pk.pick,
        pick: pk.pick,
        team: pk.team,
        playerName: session.players[pk.playerId]?.name ?? 'a player',
        fromQueue: pk.team !== session.userTeam && queued.has(pk.playerId),
      }))
      .filter((t) => isBelowLg || t.fromQueue)
    const takenNow = new Set(added.map((pk) => pk.playerId))
    setQueue((cur) => cur.filter((id) => !takenNow.has(id)))
    setToasts((cur) => [...cur, ...nextToasts].slice(-TOAST_MAX))
    for (const toast of nextToasts) {
      const timer = window.setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== toast.id))
      }, TOAST_MS)
      toastTimers.current.push(timer)
    }
  }, [session.picks, session.players, session.userTeam, isBelowLg])

  useEffect(
    () => () => {
      for (const timer of toastTimers.current) window.clearTimeout(timer)
    },
    [],
  )

  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

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
  const userRoster = session.rosters[session.userTeam] ?? []
  const canRoster = (player: MockSessionPlayer) => hasOpenSlotFor(userRoster, player.positions)
  const suggested = queuedPlayers.find(canRoster)
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

  const handlePlayerSort = (key: PlayerSortKey) => {
    if (playerSort === key) {
      setPlayerSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'))
      return
    }
    setPlayerSort(key)
    setPlayerSortDir(key === 'rk' || key === 'name' ? 'asc' : 'desc')
  }

  const resolvedPageSize = resolvePageSize(pageSize)
  const totalPages = Math.max(1, Math.ceil(listed.length / resolvedPageSize))
  const safePage = Math.min(page, totalPages)
  const pageSlice = useMemo(() => {
    const start = (safePage - 1) * resolvedPageSize
    return listed.slice(start, start + resolvedPageSize)
  }, [listed, safePage, resolvedPageSize])
  const paged = useMemo(() => {
    const rankOf = (id: string) => (isSearching ? adpRank.get(id) : userRank.get(id)) ?? Number.POSITIVE_INFINITY
    if (playerSort === 'rk' && playerSortDir === 'asc') return pageSlice
    return [...pageSlice].sort((a, b) => {
      if (playerSort === 'rk') return rankOf(b.id) - rankOf(a.id)
      if (playerSort === 'name') {
        const cmp = a.name.localeCompare(b.name)
        return playerSortDir === 'asc' ? cmp : -cmp
      }
      const statsA = statsFrom === 'projection' ? detailsById.get(a.id)?.projection : detailsById.get(a.id)?.last_year
      const statsB = statsFrom === 'projection' ? detailsById.get(b.id)?.projection : detailsById.get(b.id)?.last_year
      const va = statsA?.[playerSort]
      const vb = statsB?.[playerSort]
      if (va == null && vb == null) return rankOf(a.id) - rankOf(b.id)
      if (va == null) return 1
      if (vb == null) return -1
      const cmp = va - vb
      if (cmp !== 0) return playerSortDir === 'asc' ? cmp : -cmp
      return rankOf(a.id) - rankOf(b.id)
    })
  }, [pageSlice, playerSort, playerSortDir, isSearching, adpRank, userRank, statsFrom, detailsById])
  const from = listed.length === 0 ? 0 : (safePage - 1) * resolvedPageSize + 1
  const to = Math.min(safePage * resolvedPageSize, listed.length)

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, teamFilter, posFilter, resolvedPageSize])

  const neededDetailIds = useMemo(() => {
    const ids = paged.map((p) => p.id)
    ids.push(...queue)
    if (selectedId) ids.push(selectedId)
    for (const pk of session.picks) ids.push(pk.playerId)
    return stablePlayerIds(ids)
  }, [paged, queue, selectedId, session.picks])
  const missingDetailIds = useMemo(
    () => neededDetailIds.filter((id) => !detailsById.has(id)),
    [neededDetailIds, detailsById],
  )
  const { data: details } = useGetAdpQuery(
    { ids: missingDetailIds.join(','), include_stats: true, ranked_only: false },
    { skip: missingDetailIds.length === 0 },
  )
  useEffect(() => {
    if (!details?.players.length) return
    setDetailsById((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const player of details.players) {
        if (next.get(player.id) !== player) {
          next.set(player.id, player)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [details])

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

  const clockUnlimited = userTurn && session.userClockSec === 0
  const clockValue = (
    <ClockFace
      deadlineMs={clockDeadlineMs}
      frozenSec={clockFrozenSec}
      done={done}
      unlimited={clockUnlimited}
    />
  )

  const whoIsUp = done
    ? 'Draft complete'
    : userTurn
      ? 'You are on the clock'
      : onClock != null
        ? `${teamLabel(onClock, session.userTeam)} is on the clock`
        : '—'

  const toggleQueue = useCallback((id: string) => {
    setQueue((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }, [])
  const openPlayer = useCallback((id: string) => {
    setSelectedId(id)
  }, [])

  const selectedPlayer = selectedId ? session.players[selectedId] : undefined
  const selectedFull = selectedId ? detailsById.get(selectedId) : undefined
  const selectedMade = selectedId ? pickByPlayer.get(selectedId) : undefined
  const selectedStats: LastYearStats | null | undefined =
    statsFrom === 'projection' ? selectedFull?.projection : selectedFull?.last_year

  const moveRoster = session.rosters[viewTeam] ?? []
  const moveRow = moveFrom != null ? moveRoster[moveFrom] : undefined
  const moveDests = moveFrom != null ? groupedMoveDestinations(moveRoster, moveFrom) : []

  const tabBtn = (key: RoomTab, label: string, active: boolean) => (
    <button
      key={key}
      type="button"
      onClick={() => setTab(key)}
      className={`px-2 py-1 rounded text-xs font-semibold border ${
        active
          ? 'bg-blue-600 text-white border-blue-600'
          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
      }`}
    >
      {label}
    </button>
  )

  const playersFilters = (
    <div className="flex flex-col gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700 lg:flex-row lg:flex-wrap lg:items-center">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search players"
        className="w-full text-base rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-2 lg:ml-auto lg:w-48 lg:text-xs lg:py-1 order-first lg:order-last"
      />
      <div className="flex flex-wrap gap-1.5 lg:hidden">
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            type="button"
            onClick={() => setPosFilter((cur) => (cur === pos ? 'all' : pos))}
            className={`min-h-11 px-3 rounded-md text-sm font-semibold border ${
              posFilter === pos
                ? 'bg-blue-600 text-white border-blue-600'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
            }`}
          >
            {pos}
          </button>
        ))}
      </div>
      <select
        value={posFilter}
        onChange={(e) => setPosFilter(e.target.value)}
        className="hidden lg:block text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
      >
        <option value="all">All pos.</option>
        {POSITIONS.map((pos) => (
          <option key={pos} value={pos}>
            {pos}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2 lg:contents">
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="text-base lg:text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-2 lg:py-1"
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
          className="text-base lg:text-xs rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-2 lg:py-1"
        >
          <option value="projection">Projected</option>
          <option value="actual">Last year</option>
        </select>
      </div>
    </div>
  )

  const listPager = (className = '') =>
    listed.length > 0 ? (
      <PaginationBar
        page={safePage}
        totalPages={totalPages}
        total={listed.length}
        pageSize={resolvedPageSize}
        from={from}
        to={to}
        onPage={setPage}
        onPageSize={setPageSize}
        className={className}
      />
    ) : null

  const playerTable = (
    <div>
      {listPager('border-b border-gray-200 dark:border-gray-700')}
    <div className="overflow-auto max-h-[70vh]">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800 text-[10px] uppercase text-gray-500">
          <tr>
            <PlayerSortHeader
              label="Rk"
              col="rk"
              sortBy={playerSort}
              sortDir={playerSortDir}
              onSort={handlePlayerSort}
              align="left"
            />
            <PlayerSortHeader
              label="Player"
              col="name"
              sortBy={playerSort}
              sortDir={playerSortDir}
              onSort={handlePlayerSort}
              align="left"
            />
            <th className="px-2 py-2" />
            {LAST_YEAR_COLS.map((col) => (
              <PlayerSortHeader
                key={col.key}
                label={col.label}
                col={col.key}
                sortBy={playerSort}
                sortDir={playerSortDir}
                onSort={handlePlayerSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {paged.map((player) => {
            const full = detailsById.get(player.id)
            const stats: LastYearStats | null | undefined =
              statsFrom === 'projection' ? full?.projection : full?.last_year
            const made = pickByPlayer.get(player.id)
            return (
              <MockPlayerTableRow
                key={player.id}
                player={player}
                rank={isSearching ? adpRank.get(player.id) : userRank.get(player.id)}
                photoUrl={full?.photo_url || espnHeadshotUrl(player.espn_id)}
                stats={stats}
                madeLabel={
                  made ? `Drafted · ${teamLabel(made.team, session.userTeam)} · #${made.pick}` : null
                }
                inQueue={queuedSet.has(player.id)}
                isSuggested={suggested?.id === player.id}
                userTurn={userTurn}
                canDraft={canRoster(player)}
                onDraft={onDraft}
                onToggleQueue={toggleQueue}
              />
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
      {listPager('border-t border-gray-200 dark:border-gray-700')}
    </div>
  )

  const playerCards = (
    <div>
      {listPager('border-b border-gray-200 dark:border-gray-700')}
      <div>
        {paged.map((player) => {
          const full = detailsById.get(player.id)
          const made = pickByPlayer.get(player.id)
          return (
            <MockPlayerCard
              key={player.id}
              player={player}
              rank={isSearching ? adpRank.get(player.id) : userRank.get(player.id)}
              photoUrl={full?.photo_url || espnHeadshotUrl(player.espn_id)}
              stats={statsFrom === 'projection' ? full?.projection : full?.last_year}
              madePick={made?.pick ?? null}
              inQueue={queuedSet.has(player.id)}
              isSuggested={suggested?.id === player.id}
              userTurn={userTurn}
              canDraft={canRoster(player)}
              onOpen={openPlayer}
              onDraft={onDraft}
              onToggleQueue={toggleQueue}
            />
          )
        })}
      </div>
      {listed.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-400">
          {isSearching ? 'No players match that name.' : 'No remaining players match those filters.'}
        </p>
      ) : (
        listPager('border-t border-gray-200 dark:border-gray-700')
      )}
    </div>
  )

  const navItems: { key: RoomTab; label: string }[] = [
    { key: 'players', label: 'Players' },
    { key: 'roster', label: 'Roster' },
    { key: 'history', label: 'History' },
    { key: 'board', label: 'Board' },
    { key: 'standings', label: 'Standings' },
  ]

  return (
    <div className="relative flex flex-col gap-3 min-w-0 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0">
      {paused ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/70 px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
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
            {clockDeadlineMs != null || clockFrozenSec != null ? (
              <div className="text-white tabular-nums text-xl font-bold">
                <ClockFace
                  deadlineMs={clockDeadlineMs}
                  frozenSec={clockFrozenSec}
                  done={done}
                  unlimited={clockUnlimited}
                />{' '}
                left on the clock
              </div>
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

      {isBelowLg ? (
      <div className="sticky top-0 z-40 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
        <div className="flex items-center gap-2 px-3 py-2 bg-blue-700 text-white">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide font-bold text-blue-100">
              Round {Math.floor((pickNow - 1) / session.teams) + 1} · Pick {pickNow}
            </div>
            <div className="text-2xl font-bold tabular-nums leading-tight">{clockValue}</div>
            <div className="text-xs font-semibold truncate">{whoIsUp}</div>
          </div>
          <div className="relative" ref={moreRef}>
            <button
              type="button"
              aria-label="More actions"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((cur) => !cur)}
              className="min-h-11 min-w-11 rounded-md bg-white/15 hover:bg-white/25 text-xl font-bold leading-none"
            >
              …
            </button>
            {moreOpen ? (
              <div className="absolute right-0 mt-1 w-48 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-50">
                {session.botDelaySec > 0 && !userTurn && !done && !paused ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSimToPick()
                      setMoreOpen(false)
                    }}
                    className="w-full min-h-11 px-4 text-left text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Sim to my pick
                  </button>
                ) : null}
                {!done ? (
                  <button
                    type="button"
                    onClick={() => {
                      onPause()
                      setMoreOpen(false)
                    }}
                    className="w-full min-h-11 px-4 text-left text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    Pause
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    onLeave()
                    setMoreOpen(false)
                  }}
                  className="w-full min-h-11 px-4 text-left text-sm font-semibold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  Leave
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-stretch border-t border-gray-200 dark:border-gray-700">
          <div className="flex-1 overflow-x-auto">
            <TickerTrack
              session={session}
              pickNow={pickNow}
              total={total}
              done={done}
              userTurn={userTurn}
              currentRef={currentRef}
              windowed
            />
          </div>
        </div>
      </div>
      ) : (
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
          <div className={`px-4 py-3 min-w-[10rem] ${userTurn && !done ? 'bg-blue-600 text-white' : 'bg-gray-900 text-white'}`}>
            <div
              className={`text-[10px] uppercase tracking-wide font-bold ${
                userTurn && !done ? 'text-blue-100' : 'text-gray-400'
              }`}
            >
              {clockTitle}
            </div>
            <div className="text-2xl font-bold tabular-nums">{clockValue}</div>
          </div>
          <div className="flex-1 overflow-x-auto">
            <TickerTrack
              session={session}
              pickNow={pickNow}
              total={total}
              done={done}
              userTurn={userTurn}
              currentRef={currentRef}
              windowed
            />
          </div>
        </div>
      </div>
      )}

      {userTurn && !done && isBelowLg ? (
        <div className="rounded-lg border-2 border-blue-600 bg-blue-50 dark:bg-blue-950 dark:border-blue-400 px-4 py-3">
          <div className="text-sm font-extrabold text-blue-900 dark:text-blue-100 tracking-wide">You’re on the clock</div>
          {suggested ? (
            <button
              type="button"
              onClick={() => onDraft(suggested.id)}
              className="mt-2 w-full min-h-11 rounded-md text-sm font-bold bg-blue-600 text-white ring-2 ring-blue-300 shadow-md"
            >
              Draft {lastName(suggested.name)}
            </button>
          ) : null}
        </div>
      ) : null}

      {userTurn && !done && !isBelowLg ? (
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
                Draft {lastName(suggested.name)}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-start">
        {!isBelowLg ? (
        <aside className="w-72 shrink-0 card overflow-hidden">
          <RosterPanel
            session={session}
            viewTeam={viewTeam}
            setViewTeam={setViewTeam}
            moveFrom={moveFrom}
            setMoveFrom={setMoveFrom}
            onMoveRoster={onMoveRoster}
            largeHit={false}
            sheetMoves={false}
          />
        </aside>
        ) : null}

        <div className="flex-1 min-w-0 w-full card overflow-hidden">
          <div className="hidden lg:flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
            {tabBtn('players', 'Players', tab === 'players')}
            {tabBtn('board', 'Draft board', tab === 'board')}
            {tabBtn('standings', 'Standings', tab === 'standings')}
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
          {!isBelowLg ? (
            <QueueBar
              queuedPlayers={queuedPlayers}
              onRemove={(id) => setQueue((cur) => cur.filter((x) => x !== id))}
              onDraft={onDraft}
              userTurn={userTurn}
              canDraft={canRoster}
              snap={false}
            />
          ) : null}
          {isBelowLg && tab === 'roster' ? (
            <RosterPanel
              session={session}
              viewTeam={viewTeam}
              setViewTeam={setViewTeam}
              moveFrom={moveFrom}
              setMoveFrom={setMoveFrom}
              onMoveRoster={onMoveRoster}
              largeHit
              sheetMoves
            />
          ) : tab === 'history' ? (
            <PickHistoryList session={session} detailsById={detailsById} stacked={isBelowLg} />
          ) : tab === 'standings' ? (
            <MockProjectedStandings
              session={session}
              detailsById={detailsById}
              statsFrom={statsFrom}
              onStatsFrom={setStatsFrom}
            />
          ) : tab === 'board' ? (
            <>
              <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
                {(['round', 'team'] as BoardShowBy[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setShowBy(mode)}
                    className={`min-h-11 px-3 rounded-md text-sm font-semibold border ${
                      showBy === mode
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {mode === 'round' ? 'Round' : 'Team'}
                  </button>
                ))}
              </div>
              <DraftBoardGrid
                showBy={showBy}
                boardTeams={boardTeams}
                boardRounds={boardRounds}
                userTeam={session.userTeam}
              />
            </>
          ) : (
            <>
              {playersFilters}
              {isBelowLg ? (
                <QueueBar
                  queuedPlayers={queuedPlayers}
                  onRemove={(id) => setQueue((cur) => cur.filter((x) => x !== id))}
                  onDraft={onDraft}
                  userTurn={userTurn}
                  canDraft={canRoster}
                  snap
                />
              ) : null}
              {isBelowLg ? playerCards : playerTable}
            </>
          )}
        </div>

        {!isBelowLg ? (
          <aside className="w-72 shrink-0 card overflow-hidden flex flex-col max-h-[70vh]">
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-800 dark:text-gray-100">
              Pick history
              {session.picks.length > 0 ? (
                <span className="ml-1.5 font-normal text-gray-400">{session.picks.length}</span>
              ) : null}
            </div>
            <div ref={historyRailRef} className="min-h-0 flex-1 overflow-y-auto">
              <PickHistoryList
                session={session}
                detailsById={detailsById}
                stacked
                ascending
                className="divide-y divide-gray-100 dark:divide-gray-800"
              />
            </div>
          </aside>
        ) : null}
      </div>

      {isBelowLg ? (
        <nav
          className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="grid grid-cols-5">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? 'page' : undefined}
                aria-label={item.label}
                className={`min-h-11 px-0.5 text-[10px] font-bold leading-tight ${
                  tab === item.key ? 'text-blue-600 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'
                }`}
              >
                {item.key === 'standings' ? 'Stand' : item.label}
              </button>
            ))}
          </div>
        </nav>
      ) : null}

      <PickToasts
        toasts={toasts}
        userTeam={session.userTeam}
        placement={isBelowLg ? 'mobile' : 'desktop'}
      />

      {isBelowLg && selectedPlayer ? (
        <MockPlayerSheet
          player={selectedPlayer}
          photoUrl={selectedFull?.photo_url || espnHeadshotUrl(selectedPlayer.espn_id)}
          rank={isSearching ? adpRank.get(selectedPlayer.id) : userRank.get(selectedPlayer.id)}
          stats={selectedStats}
          statsLabel={statsFrom === 'projection' ? 'Projected' : 'Last year'}
          userTurn={userTurn && !selectedMade}
          canDraft={canRoster(selectedPlayer)}
          inQueue={queuedSet.has(selectedPlayer.id)}
          draftedLabel={
            selectedMade
              ? `Drafted · ${teamLabel(selectedMade.team, session.userTeam)} · #${selectedMade.pick}`
              : null
          }
          onClose={() => setSelectedId(null)}
          onDraft={() => {
            onDraft(selectedPlayer.id)
            setSelectedId(null)
          }}
          onToggleQueue={() => toggleQueue(selectedPlayer.id)}
        />
      ) : null}

      {isBelowLg && moveFrom != null && moveRow?.player ? (
        <RosterMoveSheet
          playerName={moveRow.player.name}
          dests={moveDests}
          onMove={(toIndex) => {
            onMoveRoster(moveFrom, toIndex)
            setMoveFrom(null)
          }}
          onClose={() => setMoveFrom(null)}
        />
      ) : null}
    </div>
  )
}
