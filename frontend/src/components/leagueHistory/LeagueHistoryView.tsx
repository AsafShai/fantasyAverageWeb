import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ActivityPlayer, PlayerHistoryMove, PlayerLeagueHistory } from '../../types/activity'
import PlayerNameLink from '../PlayerNameLink'
import {
  formatSpan,
  historySummary,
  isShortSpan,
  teamColors,
  timelineSegments,
  type TimelineSegment,
} from '../../utils/playerLeagueHistory'

const FREE_AGENT = 'Free agent'

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

const TAG: Record<PlayerHistoryMove['kind'], { label: string; cls: string }> = {
  draft: { label: 'Drafted', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  add: { label: 'Added', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  waiver: { label: 'Claimed', cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  drop: { label: 'Dropped', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  trade: { label: 'Traded', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
}

function Names({ players }: { players: ActivityPlayer[] }) {
  return (
    <>
      {players.map((p, i) => (
        <span key={p.player_id}>
          {i > 0 && ', '}
          <PlayerNameLink name={p.name} playerId={p.player_id} className="text-inherit hover:underline" />
        </span>
      ))}
    </>
  )
}

function MoveRow({ move, playerId, team }: { move: PlayerHistoryMove; playerId: number; team: (id: number | null) => string }) {
  const at = Date.parse(move.at)
  const strong = (id: number | null) => <span className="font-semibold text-gray-900 dark:text-gray-100">{team(id)}</span>
  let text: ReactNode
  let sub: ReactNode = null
  switch (move.kind) {
    case 'draft':
      text = <>Drafted by {strong(move.team_id)}</>
      sub = move.pick ? `Pick #${move.pick}${move.round ? ` (round ${move.round})` : ''}` : null
      break
    case 'add':
    case 'waiver':
      text = <>{move.kind === 'waiver' ? 'Claimed off waivers' : 'Picked up as a free agent'} by {strong(move.team_id)}</>
      sub = move.swapped.length > 0 && <>Dropped <Names players={move.swapped} /> for him</>
      break
    case 'drop':
      text = <>Dropped by {team(move.team_id)}</>
      sub = move.in_trade
        ? 'To make room in a trade'
        : move.swapped.length > 0
          ? <>To make room for <Names players={move.swapped} /></>
          : 'Released, no pickup in the same move'
      break
    case 'trade':
      text = <>Traded from {team(move.from_team_id)} to {strong(move.team_id)}</>
      break
  }
  return (
    <li className="grid grid-cols-[4rem_1fr] gap-3 py-2.5 border-t first:border-t-0 border-gray-200 dark:border-gray-700">
      <div className="text-xs text-gray-500 dark:text-gray-400 tabular-nums leading-snug">
        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">{fmtDay(at)}</div>
        {fmtTime(at)}
      </div>
      <div className="min-w-0 text-sm text-gray-800 dark:text-gray-200">
        <span className={`inline-block mr-1.5 px-1.5 py-px rounded text-[11px] font-semibold uppercase tracking-wide ${TAG[move.kind].cls}`}>
          {TAG[move.kind].label}
        </span>
        {text}
        {sub && <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{sub}</div>}
        {move.kind === 'trade' && (
          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {move.trade_sides.map((side) => (
              <div key={side.team_id} className="min-w-0 rounded-md bg-gray-50 dark:bg-gray-800 px-2.5 py-2 text-xs">
                <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {team(side.team_id)} got
                </div>
                {side.players.map((p, i) => (
                  <span key={p.player_id}>
                    {i > 0 && ', '}
                    {p.player_id === playerId
                      ? <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                      : <PlayerNameLink name={p.name} playerId={p.player_id} className="text-inherit hover:underline" />}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}
        {move.kind === 'trade' && move.trade_drops.length > 0 && (
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {move.trade_drops.map((d, i) => (
              <span key={d.team_id}>
                {i > 0 && '; '}
                {team(d.team_id)} dropped <Names players={d.players} /> to make room
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function Timeline({
  segments, colors, team,
}: { segments: TimelineSegment[]; colors: Map<number, string>; team: (id: number | null) => string }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [pinned, setPinned] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const active = hovered ?? pinned
  const total = segments.length ? segments[segments.length - 1].end - segments[0].start : 0

  useEffect(() => {
    if (pinned === null) return
    const close = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setPinned(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [pinned])

  useLayoutEffect(() => {
    if (active === null || !wrapRef.current || !tipRef.current) return
    const seg = wrapRef.current.querySelector<HTMLElement>(`[data-seg="${active}"]`)
    if (!seg) return
    const width = wrapRef.current.clientWidth
    const tip = tipRef.current.offsetWidth
    setLeft(Math.max(0, Math.min(width - tip, seg.offsetLeft + seg.offsetWidth / 2 - tip / 2)))
  }, [active])

  if (total <= 0) return null
  const a = active !== null ? segments[active] : null
  const span = a ? a.end - a.start : 0
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Who had him</div>
      <div ref={wrapRef} className="relative">
        <div className="flex h-5 rounded-md overflow-hidden bg-gray-200 dark:bg-gray-700" onPointerLeave={() => setHovered(null)}>
          {segments.map((s, i) => (
            <button
              key={i}
              type="button"
              data-seg={i}
              aria-label={`${team(s.teamId)}, ${fmtDay(s.start)} to ${s.current ? 'today' : fmtDay(s.end)}`}
              aria-pressed={pinned === i}
              className={`h-full border-r-2 last:border-r-0 border-white dark:border-gray-900 cursor-pointer transition-opacity motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-900 dark:focus-visible:outline-white ${
                s.teamId === null ? 'bg-gray-200 dark:bg-gray-700' : 'min-w-2'
              } ${active !== null && active !== i ? 'opacity-45' : ''}`}
              style={{ flex: `${((s.end - s.start) / total) * 1000} 1 0`, minWidth: s.teamId === null ? 0 : undefined, backgroundColor: s.teamId === null ? undefined : colors.get(s.teamId) }}
              onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovered(i) }}
              onClick={() => setPinned((p) => (p === i ? null : i))}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(null)}
            />
          ))}
        </div>
        {a && (
          <div
            ref={tipRef}
            role="status"
            className="absolute top-full mt-1.5 z-10 whitespace-nowrap rounded-md bg-gray-900 dark:bg-gray-100 px-2.5 py-1.5 text-xs text-white dark:text-gray-900 shadow-lg pointer-events-none"
            style={{ left }}
          >
            <div className="font-semibold">{team(a.teamId)}</div>
            {isShortSpan(span)
              ? `${fmtDay(a.start)}, ${fmtTime(a.start)} – ${fmtTime(a.end)}`
              : `${fmtDay(a.start)} – ${a.current ? 'today' : fmtDay(a.end)}`}
            {' · '}{formatSpan(span)}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-gray-400 tabular-nums">
        <span>{fmtDay(segments[0].start)}</span>
        <span>Today</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        {[...colors.entries()].map(([id, color]) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />{team(id)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-200 dark:bg-gray-700" />{FREE_AGENT}
        </span>
      </div>
    </div>
  )
}

/** Summary line, ownership timeline and the list of moves (newest first). */
export default function LeagueHistoryView({ history }: { history: PlayerLeagueHistory }) {
  const [now] = useState(Date.now)
  const names = useMemo(() => new Map(history.teams.map((t) => [t.team_id, t.name.trim()])), [history.teams])
  const team = (id: number | null) => (id === null || id === 0 ? FREE_AGENT : names.get(id) ?? `Team ${id}`)
  const colors = useMemo(() => teamColors(history.stints), [history.stints])

  if (history.moves.length === 0) {
    return <p className="py-4 text-center text-sm text-gray-400">No drafts, pickups, drops or trades in your league this season.</p>
  }
  const segments = timelineSegments(history.stints, Date.parse(history.moves[0].at), now)
  const s = historySummary(history.moves, history.stints, now)
  const facts: [string, string | number][] = [
    ['Drafted', s.draftPick ? `#${s.draftPick}` : 'Undrafted'],
    ['Teams', s.teams],
    ['Times dropped', s.dropped],
    ['Times traded', s.traded],
    ['Longest stay', formatSpan(s.longestStayMs)],
  ]
  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
        {facts.map(([k, v]) => (
          <span key={k}>{k} <b className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{v}</b></span>
        ))}
      </p>
      <Timeline segments={segments} colors={colors} team={team} />
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Moves, newest first</div>
        <ol className="max-h-[420px] overflow-y-auto border-t border-gray-200 dark:border-gray-700">
          {[...history.moves].reverse().map((m) => (
            <MoveRow key={`${m.id}-${m.kind}`} move={m} playerId={history.player_id} team={team} />
          ))}
        </ol>
      </div>
    </div>
  )
}
