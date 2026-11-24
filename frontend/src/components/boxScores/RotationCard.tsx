import { useId, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { BoxTeamBox, GameBoxScore } from '../../types/boxScore'
import { useIsDarkTheme } from '../../hooks/useIsDarkTheme'
import { MOBILE_QUERY, useMobileRedesign } from '../../mobile/flag'
import { ON_COURT_DOT_CLASS, ON_COURT_MARK_TEXT_CLASS } from './fantasyLineupMark'
import {
  buildRotation,
  clockLabel,
  mmss,
  overlapSeconds,
  periodEnd,
  periodLength,
  periodAt,
  periodName,
  periodStart,
  rangeLabel,
  seconds,
  spanPlusMinus,
  together,
  totalPlusMinus,
  type PlayerRotation,
  type Rotation,
  type Side,
  type Span,
  type TeamRotation,
} from './rotation'

const OPEN_KEY = 'fw:box-rotation-open'

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpen(open: boolean) {
  try {
    if (open) localStorage.setItem(OPEN_KEY, '1')
    else localStorage.removeItem(OPEN_KEY)
  } catch {
    // storage blocked: the card just starts collapsed next time
  }
}

function subscribeWidth(cb: () => void) {
  const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null
  mq?.addEventListener?.('change', cb)
  return () => mq?.removeEventListener?.('change', cb)
}

/** Phone layout below `md`, whatever the redesign flag says. */
function usePhoneLayout(): boolean {
  const redesign = useMobileRedesign()
  const narrow = useSyncExternalStore(
    subscribeWidth,
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  )
  return redesign || narrow
}

// ── colors ──

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbHex(rgb: number[]): string {
  return `#${rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

function luminance(hex: string): number {
  const weights = [0.2126, 0.7152, 0.0722]
  return hexRgb(hex).reduce((sum, v, i) => {
    const c = v / 255
    return sum + weights[i] * (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  }, 0)
}

function mix(hex: string, to: string, t: number): string {
  const a = hexRgb(hex)
  const b = hexRgb(to)
  return rgbHex(a.map((v, i) => v + (b[i] - v) * t))
}

/** Team color, lifted on dark backgrounds and deepened on light ones when it would vanish. */
function barColor(hex: string, dark: boolean): string {
  const l = luminance(hex)
  if (dark && l < 0.12) return mix(hex, '#ffffff', 0.4)
  if (!dark && l > 0.55) return mix(hex, '#000000', 0.35)
  return hex
}

interface Palette {
  bar: string
  solo: string
  dim: string
  ink: string
  track: string
  together: string
  togetherInk: string
  hatch: string
}

function palette(teamColor: string, dark: boolean): Palette {
  const base = /^[0-9A-Fa-f]{6}$/.test(teamColor) ? `#${teamColor}` : '#6B7280'
  const bar = barColor(base, dark)
  const track = dark ? '#1F2937' : '#F3F4F6'
  return {
    bar,
    solo: mix(bar, track, 0.55),
    dim: mix(bar, track, 0.75),
    ink: luminance(bar) > 0.35 ? '#111827' : '#FFFFFF',
    track,
    together: dark ? '#34D399' : '#047857',
    togetherInk: dark ? '#052E16' : '#FFFFFF',
    hatch: dark ? 'rgba(154,164,181,0.16)' : 'rgba(91,100,116,0.22)',
  }
}

// ── formatting ──

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

function pmClass(n: number): string {
  return n > 0 ? 'text-emerald-700 dark:text-emerald-400' : n < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-gray-500 dark:text-gray-400'
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length > 2 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(parts[parts.length - 1])) return parts.slice(-2).join(' ')
  return parts[parts.length - 1] ?? name
}

// ── timeline geometry ──

interface View {
  label: string
  w0: number
  w1: number
  /** Period numbers on show, for quarter labels. */
  periods: number[]
}

interface Tick { at: number; label: string; strong: boolean }
interface Line { at: number; faint?: boolean; half?: boolean }

function gameView(rotation: Rotation): View {
  return { label: 'Game', w0: 0, w1: rotation.total, periods: Array.from({ length: rotation.periods }, (_, i) => i + 1) }
}

function periodView(period: number): View {
  return { label: periodName(period), w0: periodStart(period), w1: periodEnd(period), periods: [period] }
}

/** Clock ticks, faint minute lines and period breaks for a view. */
function axis(view: View, compact: boolean): { ticks: Tick[]; grid: Line[]; breaks: Line[] } {
  const ticks: Tick[] = []
  const grid: Line[] = []
  const breaks: Line[] = []
  if (view.periods.length === 1) {
    const period = view.periods[0]
    const minutes = periodLength(period) / 60
    const step = period <= 4 ? 3 : 1
    for (let k = 0; k <= minutes; k++) {
      const at = view.w0 + k * 60
      if (k % step === 0) ticks.push({ at, label: String(minutes - k), strong: k === 0 || k === minutes || (period <= 4 && k % 6 === 0) })
      if (k > 0 && k < minutes) grid.push({ at, faint: k % step !== 0 })
    }
    return { ticks, grid, breaks }
  }
  const marks = compact ? [0, 6] : [0, 3, 6, 9]
  for (const period of view.periods) {
    const start = periodStart(period)
    if (period <= 4) {
      for (const minute of marks) {
        ticks.push({ at: start + minute * 60, label: String(12 - minute), strong: minute === 0 })
        if (minute > 0) grid.push({ at: start + minute * 60 })
      }
    } else {
      ticks.push({ at: start, label: '5', strong: true })
    }
    if (period > 1) breaks.push({ at: start, half: period === 3 })
  }
  ticks.push({ at: view.w1, label: '0', strong: false })
  return { ticks, grid, breaks }
}

function makeScale(view: View) {
  const span = view.w1 - view.w0
  const clamp = (t: number) => Math.min(Math.max(t, view.w0), view.w1)
  return {
    span,
    left: (t: number) => `${(((clamp(t) - view.w0) / span) * 100).toFixed(3)}%`,
    width: (sec: number) => `${((sec / span) * 100).toFixed(3)}%`,
    inView: (x: Pick<Span, 'start' | 'end'>) => Math.max(0, Math.min(x.end, view.w1) - Math.max(x.start, view.w0)),
  }
}

// ── the comparison ──

interface Comparison {
  picked: PlayerRotation[]
  shared: Span[]
  sharedSeconds: number
}

function compare(team: TeamRotation, picks: string[]): Comparison {
  const picked = picks.map(id => team.players.find(player => player.id === id)).filter((p): p is PlayerRotation => Boolean(p))
  const shared = picked.length >= 2 ? together(picked.map(player => player.stints)) : []
  return { picked, shared, sharedSeconds: seconds(shared) }
}

interface Shared {
  rotation: Rotation
  team: BoxTeamBox
  rot: TeamRotation
  side: Side
  colors: Palette
  picks: string[]
  setPicks: (next: string[]) => void
  cmp: Comparison
  mineIds?: ReadonlySet<string>
}

function togglePick(shared: Shared, id: string) {
  const { picks, setPicks } = shared
  setPicks(picks.includes(id) ? picks.filter(x => x !== id) : [...picks, id])
}

/** What the summary says: one pick = his stints, two or more = the stretches they shared. */
function summary(shared: Shared) {
  const { cmp, side, rotation } = shared
  const live = rotation.live
  const elapsed = live && rotation.now != null ? rotation.now : rotation.total
  const n = cmp.picked.length
  if (n === 1) {
    const player = cmp.picked[0]
    const pm = totalPlusMinus(side, player.stints)
    return {
      together: false,
      name: player.player.name,
      total: mmss(seconds(player.stints)),
      count: `${player.stints.length} ${player.stints.length === 1 ? 'stint' : 'stints'}`,
      pct: '',
      pm,
      list: player.stints,
      shares: [] as { name: string; own: string; pct: string }[],
      nowNote: live && player.player.on_court ? 'on the court now' : '',
    }
  }
  const pm = totalPlusMinus(side, cmp.shared)
  const lastOpen = cmp.shared.length > 0 && cmp.shared[cmp.shared.length - 1].open
  return {
    together: true,
    name: cmp.picked.map(player => lastName(player.player.name)).join(' + '),
    total: mmss(cmp.sharedSeconds),
    count: `${cmp.shared.length} ${cmp.shared.length === 1 ? 'stretch' : 'stretches'}`,
    pct: `${Math.round((cmp.sharedSeconds / Math.max(elapsed, 1)) * 100)}% of the game${live ? ' so far' : ''}`,
    pm,
    list: cmp.shared,
    shares: cmp.picked.map(player => {
      const own = seconds(player.stints)
      return { name: lastName(player.player.name), own: mmss(own), pct: own > 0 ? `${Math.round((cmp.sharedSeconds / own) * 100)}%` : '—' }
    }),
    nowNote: live && lastOpen ? 'on together now' : '',
  }
}

// ── pieces ──

function Check({ on, color, size }: { on: boolean; color: string; size: 'sm' | 'md' }) {
  const box = size === 'md' ? 'h-[18px] w-[18px] rounded' : 'h-3.5 w-3.5 rounded-[3px]'
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center border-[1.5px] ${box} ${on ? '' : 'border-gray-400 dark:border-gray-500'}`}
      style={on ? { background: color, borderColor: color } : undefined}
    >
      <svg width={size === 'md' ? 12 : 10} height={size === 'md' ? 12 : 10} viewBox="0 0 12 12" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: on ? 1 : 0 }}>
        <path d="M2.5 6.2l2.3 2.3 4.7-5" />
      </svg>
    </span>
  )
}

/** Track background: minute lines, period breaks, hatched future, now line. */
function Track({ view, height, colors, rotation, compact, children }: {
  view: View
  height: number
  colors: Palette
  rotation: Rotation
  compact: boolean
  children: ReactNode
}) {
  const scale = makeScale(view)
  const { grid, breaks } = axis(view, compact)
  const now = rotation.live ? rotation.now : null
  const futureFrom = now != null && now < view.w1 ? Math.max(now, view.w0) : null
  return (
    <div className="relative w-full rounded-[3px]" style={{ height, background: colors.track }}>
      {grid.map(line => (
        <span key={`g${line.at}`} aria-hidden="true" className="absolute inset-y-0 w-px bg-white dark:bg-gray-900" style={{ left: scale.left(line.at), opacity: line.faint ? 0.5 : 1 }} />
      ))}
      {futureFrom != null && (
        <span
          aria-hidden="true"
          data-testid="rotation-future"
          className="absolute inset-y-0 right-0 rounded-r-[3px]"
          style={{ left: scale.left(futureFrom), background: `repeating-linear-gradient(135deg, ${colors.hatch} 0 2px, transparent 2px 6px)` }}
        />
      )}
      {breaks.map(line => (
        <span
          key={`b${line.at}`}
          aria-hidden="true"
          className={`absolute w-px ${compact ? '-top-1 -bottom-1' : '-top-[7px] -bottom-[7px]'} ${line.half ? 'bg-gray-400 dark:bg-gray-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          style={{ left: scale.left(line.at) }}
        />
      ))}
      {children}
      {now != null && now > view.w0 && now < view.w1 && (
        <span aria-hidden="true" data-testid="rotation-now" className="absolute -top-1 -bottom-1 z-[3] -ml-px w-0.5 bg-rose-600 dark:bg-rose-400" style={{ left: scale.left(now) }} />
      )}
    </div>
  )
}

/** One stint's bar. Picked players with company show the shared parts in full color. */
function stintStyle(scale: ReturnType<typeof makeScale>, a: number, b: number, background: string, open: boolean): CSSProperties {
  return {
    left: scale.left(a),
    width: scale.width(b - a),
    background,
    borderRadius: open ? '3px 0 0 3px' : 3,
  }
}

function sharedSegments(shared: Span[], a: number, b: number): { left: string; width: string }[] {
  const w = b - a
  return shared
    .filter(x => x.end > a && x.start < b)
    .map(x => {
      const xa = Math.max(x.start, a)
      const xb = Math.min(x.end, b)
      return { left: `${(((xa - a) / w) * 100).toFixed(2)}%`, width: `${(((xb - xa) / w) * 100).toFixed(2)}%` }
    })
}

function Legend({ shared, compact }: { shared: Shared; compact: boolean }) {
  const { colors, cmp, rotation } = shared
  const multi = cmp.picked.length >= 2
  const swatch = (background: string) => <span aria-hidden="true" className="inline-block h-2 w-3.5 rounded-sm" style={{ background }} />
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      <span className="inline-flex items-center gap-1.5">{swatch(colors.bar)}On the floor</span>
      {multi && (
        <>
          <span className="inline-flex items-center gap-1.5">{swatch(colors.solo)}{compact ? 'Without the others' : 'On without the others'}</span>
          <span className="inline-flex items-center gap-1.5">{swatch(colors.together)}{compact ? 'Together' : 'All picked players on together'}</span>
        </>
      )}
      {rotation.live && (
        <>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${ON_COURT_DOT_CLASS}`} />On the court now</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0.5 bg-rose-600 dark:bg-rose-400" />Game clock</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-3.5 rounded-sm" style={{ background: `repeating-linear-gradient(135deg, ${colors.hatch} 0 2px, transparent 2px 6px)` }} />
            Still to play
          </span>
        </>
      )}
      {!compact && (
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-px bg-gray-400 dark:bg-gray-500" />Quarter break</span>
      )}
      <span>
        From the play-by-play.{compact ? '' : ' MIN is the official box score;'} +/- is the score change while on the floor.
      </span>
    </div>
  )
}

function StretchList({ shared, label, compact }: { shared: Shared; label: string; compact: boolean }) {
  const s = summary(shared)
  const multi = shared.cmp.picked.length >= 2
  if (s.list.length === 0) return null
  if (compact) {
    return (
      <div role="table" aria-label={label}>
        {s.list.map((x, i) => {
          const pm = spanPlusMinus(shared.side, x)
          return (
            <div role="row" key={x.start} className="flex items-baseline gap-2 py-1 text-[13px] tabular-nums">
              <span role="cell" className="w-3.5 shrink-0 text-gray-500 dark:text-gray-400">{i + 1}</span>
              <span role="cell" className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">{rangeLabel(x)}</span>
              <span role="cell" className="w-11 text-right font-semibold text-gray-900 dark:text-gray-100">{mmss(x.end - x.start)}</span>
              <span role="cell" className={`w-8 text-right font-semibold ${pmClass(pm)}`}>{signed(pm)}</span>
            </div>
          )
        })}
      </div>
    )
  }
  const cols = 'grid grid-cols-[28px_minmax(0,1fr)_minmax(0,1fr)_56px_44px] gap-2'
  return (
    <div role="table" aria-label={label} className="mt-2.5 max-w-[520px] border-t border-gray-200 dark:border-gray-700">
      <div role="row" className={`${cols} pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400`}>
        <span role="columnheader">#</span>
        <span role="columnheader">{multi ? 'Together from' : 'In'}</span>
        <span role="columnheader">{multi ? 'Until' : 'Out'}</span>
        <span role="columnheader" className="text-right">Time</span>
        <span role="columnheader" className="text-right">+/-</span>
      </div>
      {s.list.map((x, i) => {
        const pm = spanPlusMinus(shared.side, x)
        return (
          <div role="row" key={x.start} className={`${cols} py-0.5 tabular-nums`}>
            <span role="cell" className="text-gray-500 dark:text-gray-400">{i + 1}</span>
            <span role="cell">{clockLabel(x.start)}</span>
            <span role="cell">{x.open ? 'Now' : clockLabel(x.end, true)}</span>
            <span role="cell" className="text-right font-semibold text-gray-900 dark:text-gray-100">{mmss(x.end - x.start)}</span>
            <span role="cell" className={`text-right font-semibold ${pmClass(pm)}`}>{signed(pm)}</span>
          </div>
        )
      })}
    </div>
  )
}

function groupsOf(rot: TeamRotation) {
  return [
    { label: 'Starters', players: rot.players.filter(player => player.starter) },
    { label: 'Bench', players: rot.players.filter(player => !player.starter) },
  ].filter(group => group.players.length > 0)
}

function isMine(ids: ReadonlySet<string> | undefined, id: string) {
  return Boolean(ids && id && ids.has(id))
}

// ── desktop ──

function DesktopBody({ shared }: { shared: Shared }) {
  const { rotation, rot, colors, cmp, team, side, picks, setPicks, mineIds } = shared
  const [hover, setHover] = useState<{ side: Side; id: string; index: number } | null>(null)
  const view = gameView(rotation)
  const scale = makeScale(view)
  const { ticks } = axis(view, false)
  const n = cmp.picked.length
  const s = summary(shared)
  const active = hover && hover.side === side ? hover : null
  const detailPlayer = active ? rot.players.find(player => player.id === active.id) : undefined
  const detailStint = detailPlayer?.stints[active!.index]
  const grid = 'grid grid-cols-[200px_minmax(0,1fr)_48px] items-center gap-3'

  return (
    <>
      <div aria-live="polite" className="rounded-lg bg-gray-50 px-3 py-2.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
        {n === 0 ? (
          <p className="flex min-h-7 items-center gap-2 text-gray-500 dark:text-gray-400">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><circle cx="8" cy="8" r="6.5" /><path d="M8 7.2v4M8 4.8v.1" /></svg>
            Click player names below to highlight them and see how many minutes they shared, in total and stretch by stretch.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              {cmp.picked.map(player => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setPicks(picks.filter(id => id !== player.id))}
                  aria-label={`Remove ${player.player.name} from the comparison`}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-gray-200 bg-white pl-2.5 pr-2 text-xs font-semibold text-gray-900 hover:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                >
                  <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: colors.bar }} />
                  {lastName(player.player.name)}
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-gray-400"><path d="M3 3l6 6M9 3l-6 6" /></svg>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPicks([])}
                className="ml-auto h-7 rounded px-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-indigo-300"
              >
                Clear
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className={`text-[11px] font-semibold uppercase tracking-wider ${s.together ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {s.together ? 'Together' : `${s.name} on the floor`}
              </span>
              <span className="text-2xl font-bold leading-none tabular-nums text-gray-900 dark:text-gray-100">{s.total}</span>
              <span className="text-gray-500 dark:text-gray-400">{[s.together ? s.pct : '', s.count, s.nowNote].filter(Boolean).join(' · ')}</span>
              <span className="tabular-nums"><span className="text-gray-500 dark:text-gray-400">+/- </span><b className={pmClass(s.pm)}>{signed(s.pm)}</b></span>
            </div>
            {n >= 2 && (
              <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 tabular-nums text-gray-500 dark:text-gray-400">
                {s.shares.map(x => (
                  <span key={x.name}><b className="font-semibold text-gray-700 dark:text-gray-200">{x.name}</b> {x.own} on the floor · {x.pct} of it together</span>
                ))}
              </div>
            )}
            <StretchList shared={shared} label={n >= 2 ? 'Stretches on the floor together' : 'Stints'} compact={false} />
            {n >= 2 && cmp.shared.length === 0 && (
              <p className="mt-2 text-gray-500 dark:text-gray-400">They were never on the floor at the same time.</p>
            )}
          </>
        )}
      </div>

      <div aria-live="polite" className="mt-2 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed border-gray-200 px-3 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200">
        {detailPlayer && detailStint ? (
          <>
            <span className="inline-flex items-center gap-1.5 font-semibold text-gray-900 dark:text-gray-100">
              <span className="text-[11px] font-medium tabular-nums text-gray-500 dark:text-gray-400">{detailPlayer.player.jersey}</span>
              {detailPlayer.player.name}
            </span>
            <span className="text-gray-500 dark:text-gray-400">Stint {active!.index + 1} of {detailPlayer.stints.length}</span>
            <span className="tabular-nums">
              <span className="text-gray-500 dark:text-gray-400">In </span>{clockLabel(detailStint.start)}
              <span className="text-gray-500 dark:text-gray-400">{'  →  '}Out </span>{detailStint.open ? 'now' : clockLabel(detailStint.end, true)}
            </span>
            <span className="tabular-nums"><span className="text-gray-500 dark:text-gray-400">On floor </span><b className="text-gray-900 dark:text-gray-100">{mmss(detailStint.end - detailStint.start)}</b></span>
            <span className="tabular-nums"><span className="text-gray-500 dark:text-gray-400">+/- </span><b className={pmClass(spanPlusMinus(side, detailStint))}>{signed(spanPlusMinus(side, detailStint))}</b></span>
            {n >= 2 && picks.includes(detailPlayer.id) && (
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                {mmss(overlapSeconds(cmp.shared, detailStint.start, detailStint.end))} of it with all picked players
              </span>
            )}
          </>
        ) : (
          <span className="text-gray-500 dark:text-gray-400">Hover a bar for that stint&apos;s check-in, check-out and +/-.</span>
        )}
      </div>

      <div role="group" aria-label={`${team.name} rotation: each bar is a stint on the floor`} className="mt-3">
        <div className={`${grid} items-end pb-1.5`}>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Clock: minutes left in the quarter</span>
          <div className="relative h-8" aria-hidden="true">
            {view.periods.map(period => (
              <span
                key={period}
                className="absolute top-0 -translate-x-1/2 text-[11px] font-bold tracking-wide text-gray-700 dark:text-gray-200"
                style={{ left: scale.left((periodStart(period) + periodEnd(period)) / 2) }}
              >
                {periodName(period)}
              </span>
            ))}
            {ticks.map((tick, i) => (
              <span
                key={`${tick.at}-${i}`}
                className={`absolute top-[18px] text-[10px] tabular-nums ${tick.strong ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'} ${i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
                style={{ left: scale.left(tick.at) }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <span className="text-right text-[11px] font-semibold tracking-wide text-gray-500 dark:text-gray-400">MIN</span>
        </div>

        {n >= 2 && (
          <div className={`${grid} -mx-2 mb-1 mt-0.5 min-h-9 rounded-md bg-emerald-50 px-2 dark:bg-emerald-950/60`} data-testid="rotation-together">
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">Together</span>
              <span className="truncate text-[11px] text-gray-700 dark:text-gray-200">{s.name}</span>
            </span>
            <Track view={view} height={16} colors={colors} rotation={rotation} compact={false}>
              {cmp.shared.map(x => {
                const w = x.end - x.start
                return (
                  <span
                    key={x.start}
                    className="absolute inset-y-0 flex min-w-[3px] items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-bold tabular-nums"
                    style={{ ...stintStyle(scale, x.start, x.end, colors.together, x.open), color: colors.togetherInk }}
                  >
                    {w / view.w1 >= 0.065 ? mmss(w) : ''}
                  </span>
                )
              })}
            </Track>
            <span className="text-right text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{mmss(cmp.sharedSeconds)}</span>
          </div>
        )}

        {groupsOf(rot).map(group => (
          <div key={group.label}>
            <p className="pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{group.label}</p>
            {group.players.map(player => {
              const picked = picks.includes(player.id)
              const mode = n === 0 ? 'all' : picked ? 'picked' : 'dim'
              const split = mode === 'picked' && n >= 2
              const base = mode === 'dim' ? colors.dim : split ? colors.solo : colors.bar
              const mine = isMine(mineIds, player.id)
              return (
                <div
                  key={player.id}
                  data-testid="rotation-row"
                  className={`${grid} -mx-2 h-8 rounded border-t border-gray-100 px-2 dark:border-gray-800 ${mine ? 'bg-blue-50 shadow-[inset_3px_0_0_0_#2563eb] dark:bg-blue-950' : picked ? 'bg-gray-50 dark:bg-gray-800/60' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => togglePick(shared, player.id)}
                    aria-pressed={picked}
                    aria-label={`${picked ? 'Remove' : 'Compare'} ${player.player.name}`}
                    className="-ml-1 flex h-7 min-w-0 items-center gap-2 rounded px-1 text-left text-xs hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:hover:bg-gray-800"
                  >
                    <Check on={picked} color={colors.bar} size="sm" />
                    <span className="w-4 shrink-0 text-right text-[11px] font-medium tabular-nums text-gray-500 dark:text-gray-400">{player.player.jersey}</span>
                    <span className={`truncate ${mode === 'dim' ? 'font-medium text-gray-500 dark:text-gray-400' : picked ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-900 dark:text-gray-100'}`}>
                      {player.player.name}
                    </span>
                    {rotation.live && player.player.on_court && (
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ON_COURT_DOT_CLASS}`} title="On court" aria-label="On court" />
                    )}
                  </button>
                  <Track view={view} height={16} colors={colors} rotation={rotation} compact={false}>
                    {player.stints.map((stint, index) => {
                      const w = stint.end - stint.start
                      const on = active?.id === player.id && active.index === index
                      const segments = split ? sharedSegments(cmp.shared, stint.start, stint.end) : []
                      const label = !split && mode !== 'dim' && w / view.w1 >= 0.065 ? mmss(w) : ''
                      const pick = () => setHover({ side, id: player.id, index })
                      return (
                        <button
                          key={stint.start}
                          type="button"
                          className={`absolute inset-y-0 min-w-[3px] cursor-pointer overflow-hidden border-0 p-0 hover:brightness-110 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${on ? 'z-[2] outline-2 outline-offset-1 outline-gray-900 dark:outline-gray-100' : ''}`}
                          style={stintStyle(scale, stint.start, stint.end, base, stint.open)}
                          onClick={pick}
                          onMouseEnter={pick}
                          onFocus={pick}
                          aria-pressed={on}
                          aria-label={`${player.player.name}, stint ${index + 1} of ${player.stints.length}: in ${clockLabel(stint.start)}, out ${stint.open ? 'now' : clockLabel(stint.end, true)}, ${mmss(w)} on the floor, ${signed(spanPlusMinus(side, stint))}`}
                        >
                          {segments.map(seg => (
                            <span key={seg.left} className="absolute inset-y-0" style={{ left: seg.left, width: seg.width, background: colors.bar }} />
                          ))}
                          <span className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-semibold tabular-nums" style={{ color: colors.ink }}>
                            {label}
                          </span>
                        </button>
                      )
                    })}
                  </Track>
                  <span className={`text-right text-xs font-semibold tabular-nums ${mode === 'dim' ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
                    {player.player.min || '—'}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
      <Legend shared={shared} compact={false} />
    </>
  )
}

// ── phone ──

function PhoneBody({ shared, zoom, setZoom }: { shared: Shared; zoom: number; setZoom: (period: number) => void }) {
  const { rotation, rot, colors, cmp, picks, setPicks, mineIds } = shared
  const [details, setDetails] = useState(false)
  const now = rotation.live ? rotation.now : null
  const views = [gameView(rotation), ...Array.from({ length: rotation.periods }, (_, i) => periodView(i + 1))]
  const view = zoom === 0 ? views[0] : views[zoom] ?? views[0]
  const scale = makeScale(view)
  const { ticks } = axis(view, true)
  const n = cmp.picked.length
  const s = summary(shared)
  const sharedInView = cmp.shared.filter(x => scale.inView(x) > 0.5)
  const nowShown = now != null && now > view.w0 && now < view.w1
  const nowNote = now != null && nowShown && zoom !== 0 ? ` · now ${clockLabel(now).split(' ')[1]}` : ''
  const columns = `1.4fr repeat(${views.length - 1}, minmax(0, 1fr))`

  return (
    <>
      <div role="group" aria-label="Zoom the timeline" className="grid gap-[3px] rounded-[10px] bg-gray-100 p-[3px] dark:bg-gray-800" style={{ gridTemplateColumns: columns }}>
        {views.map((v, i) => {
          const pressed = i === zoom
          const disabled = now != null && i > 0 && v.w0 >= now
          return (
            <button
              key={v.label}
              type="button"
              onClick={() => setZoom(i)}
              disabled={disabled}
              aria-pressed={pressed}
              className={`min-h-10 rounded-lg text-[13px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:cursor-default disabled:opacity-45 ${pressed ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}
            >
              {v.label}
            </button>
          )
        })}
      </div>

      <div
        aria-live="polite"
        data-testid="rotation-summary"
        className="sticky top-[calc(var(--mr-hdr-h,0px)+8px)] z-[5] mt-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs text-gray-700 shadow-[0_2px_8px_rgba(14,23,38,0.08)] dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
      >
        {n === 0 ? (
          <p className="flex min-h-6 items-center gap-2 text-gray-500 dark:text-gray-400">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M5.5 8.2l1.8 1.8 3.4-3.6" /></svg>
            Tap players to see how long they {rotation.live ? 'have shared' : 'shared'} the floor.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate text-[11px] font-bold uppercase tracking-wide ${s.together ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {s.together ? `Together · ${s.name}` : s.name}
              </span>
              <button
                type="button"
                onClick={() => setPicks([])}
                className="min-h-10 shrink-0 px-1 text-[13px] font-semibold text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:text-indigo-300"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mr-num text-[26px] font-bold leading-none tabular-nums text-gray-900 dark:text-gray-100">{s.total}</span>
              <b className={`text-[15px] tabular-nums ${pmClass(s.pm)}`}>{signed(s.pm)}</b>
              <button
                type="button"
                onClick={() => setDetails(!details)}
                aria-expanded={details}
                className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              >
                Details
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={details ? { transform: 'rotate(180deg)' } : undefined}><path d="M4 6l4 4 4-4" /></svg>
              </button>
            </div>
            <p className="mt-1 text-gray-500 dark:text-gray-400">
              {s.together
                ? [`${s.count}${rotation.live ? ' so far' : ''}`, rotation.live ? s.nowNote : s.pct].filter(Boolean).join(' · ')
                : [`${rotation.live ? 'So far' : 'On the floor'} · ${s.count}`, s.nowNote].filter(Boolean).join(' · ')}
            </p>
            {details && (
              <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
                {n >= 2 && (
                  <div className="mb-2 flex flex-col gap-0.5 tabular-nums text-gray-500 dark:text-gray-400">
                    {s.shares.map(x => (
                      <span key={x.name}><b className="font-semibold text-gray-700 dark:text-gray-200">{x.name}</b> {x.own} {rotation.live ? 'so far' : 'on the floor'} · {x.pct} of it together</span>
                    ))}
                  </div>
                )}
                <StretchList shared={shared} label={n >= 2 ? 'Stretches on the floor together' : 'Stints'} compact />
                {n >= 2 && cmp.shared.length === 0 && <p className="text-gray-500 dark:text-gray-400">They were never on the floor at the same time.</p>}
              </div>
            )}
          </>
        )}
      </div>

      <div className="mt-3 px-1" aria-hidden="true">
        <div className="relative" style={{ height: zoom === 0 ? 30 : 14 }}>
          {zoom === 0 && view.periods.map(period => (
            <span
              key={period}
              className="absolute top-0 -translate-x-1/2 text-[11px] font-bold text-gray-700 dark:text-gray-200"
              style={{ left: scale.left((periodStart(period) + periodEnd(period)) / 2) }}
            >
              {periodName(period)}
            </span>
          ))}
          {ticks.map((tick, i) => (
            <span
              key={`${tick.at}-${i}`}
              className={`absolute text-[10px] tabular-nums ${tick.strong && zoom !== 0 ? 'font-semibold text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400'} ${i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'}`}
              style={{ left: scale.left(tick.at), top: zoom === 0 ? 17 : 0 }}
            >
              {tick.label}
            </span>
          ))}
          {nowShown && (
            <span className="absolute -bottom-[7px] -ml-1 h-0 w-0 border-x-4 border-t-[5px] border-x-transparent border-t-rose-600 dark:border-t-rose-400" style={{ left: scale.left(now!) }} />
          )}
        </div>
        <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
          {zoom === 0 ? 'Minutes left in each quarter' : `${view.label} · minutes left${nowNote}`}
        </p>
      </div>

      {n >= 2 && (
        <div className="mt-2 rounded-lg bg-emerald-50 px-1 py-2 dark:bg-emerald-950/60" data-testid="rotation-together">
          <div className="mb-1.5 flex min-w-0 items-baseline gap-1.5">
            <span className="text-[13px] font-bold text-emerald-700 dark:text-emerald-400">Together</span>
            <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-200">{s.name}</span>
            <span className="text-[13px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {zoom === 0 ? mmss(cmp.sharedSeconds) : `${mmss(sharedInView.reduce((sum, x) => sum + scale.inView(x), 0))} in ${view.label}`}
            </span>
          </div>
          <Track view={view} height={18} colors={colors} rotation={rotation} compact>
            {sharedInView.map(x => {
              const a = Math.max(x.start, view.w0)
              const b = Math.min(x.end, view.w1)
              return (
                <span
                  key={x.start}
                  className="absolute inset-y-0 flex min-w-[2px] items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-bold tabular-nums"
                  style={{ ...stintStyle(scale, a, b, colors.together, x.open && b === x.end), color: colors.togetherInk }}
                >
                  {(b - a) / scale.span >= 0.13 ? mmss(b - a) : ''}
                </span>
              )
            })}
          </Track>
        </div>
      )}

      {groupsOf(rot).map(group => (
        <div key={group.label}>
          <p className="px-1 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{group.label}</p>
          {group.players.map(player => {
            const picked = picks.includes(player.id)
            const mode = n === 0 ? 'all' : picked ? 'picked' : 'dim'
            const split = mode === 'picked' && n >= 2
            const base = mode === 'dim' ? colors.dim : split ? colors.solo : colors.bar
            const shown = player.stints.reduce((sum, x) => sum + scale.inView(x), 0)
            const mine = isMine(mineIds, player.id)
            const onCourt = rotation.live && player.player.on_court
            return (
              <div
                key={player.id}
                data-testid="rotation-row"
                className={`rounded-md border-t border-gray-100 dark:border-gray-800 ${mine ? 'bg-blue-50 shadow-[inset_3px_0_0_0_#2563eb] dark:bg-blue-950' : picked ? 'bg-gray-50 dark:bg-gray-800/60' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => togglePick(shared, player.id)}
                  aria-pressed={picked}
                  aria-label={`${picked ? 'Remove' : 'Compare'} ${player.player.name}${onCourt ? ', on the court' : ''}, ${player.player.min || 0} minutes${rotation.live ? ' so far' : ''}`}
                  className="flex w-full flex-col gap-1.5 px-1 pb-2.5 pt-[9px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <span className="flex w-full min-w-0 items-center gap-2">
                    <Check on={picked} color={colors.bar} size="md" />
                    <span className="w-[18px] shrink-0 text-right text-[11px] font-medium tabular-nums text-gray-500 dark:text-gray-400">{player.player.jersey}</span>
                    <span className={`min-w-0 truncate text-[13px] ${mode === 'dim' ? 'font-medium text-gray-500 dark:text-gray-400' : picked ? 'font-bold text-gray-900 dark:text-gray-100' : 'font-medium text-gray-900 dark:text-gray-100'}`}>
                      {player.player.name}
                    </span>
                    {onCourt && (
                      <span className={`inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-wide ${ON_COURT_MARK_TEXT_CLASS}`}>
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${ON_COURT_DOT_CLASS}`} />On
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${mode === 'dim' || shown === 0 ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-gray-100'}`}>
                      {zoom === 0 ? (player.player.min || '—') : shown > 0 ? mmss(shown) : '—'}
                      {zoom === 0 && <span className="ml-[3px] text-[11px] font-medium text-gray-500 dark:text-gray-400">min</span>}
                    </span>
                  </span>
                  <Track view={view} height={18} colors={colors} rotation={rotation} compact>
                    {player.stints.filter(x => scale.inView(x) > 0.5).map(stint => {
                      const a = Math.max(stint.start, view.w0)
                      const b = Math.min(stint.end, view.w1)
                      const segments = split ? sharedSegments(cmp.shared, a, b) : []
                      const label = !split && mode !== 'dim' && (b - a) / scale.span >= 0.13 ? mmss(b - a) : ''
                      return (
                        <span key={stint.start} className="absolute inset-y-0 min-w-[2px] overflow-hidden" style={stintStyle(scale, a, b, base, stint.open && b === stint.end)}>
                          {segments.map(seg => (
                            <span key={seg.left} className="absolute inset-y-0" style={{ left: seg.left, width: seg.width, background: colors.bar }} />
                          ))}
                          <span className="absolute inset-0 flex items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-semibold tabular-nums" style={{ color: colors.ink }}>
                            {label}
                          </span>
                        </span>
                      )
                    })}
                  </Track>
                </button>
              </div>
            )
          })}
        </div>
      ))}
      <Legend shared={shared} compact />
    </>
  )
}

// ── the card ──

/**
 * Collapsible "Rotation" card under a team's box: when each player was on the
 * floor, and how long any players you pick shared it. Not rendered when the
 * box has no usable play-by-play.
 */
export default function RotationCard({ game, side, mineIds }: { game: GameBoxScore; side: Side; mineIds?: ReadonlySet<string> }) {
  const rotation = useMemo(() => buildRotation(game), [game])
  const [open, setOpen] = useState(readOpen)
  const [picks, setPickMap] = useState<Record<Side, string[]>>({ away: [], home: [] })
  // A live game opens on the period being played.
  const [zoom, setZoom] = useState(() => (rotation?.live && rotation.now != null ? periodAt(rotation.now, true) : 0))
  const phone = usePhoneLayout()
  const dark = useIsDarkTheme()
  const bodyId = useId()
  const team = game[side]
  const colors = useMemo(() => palette(team.color, dark), [team.color, dark])
  const rot = rotation?.[side]
  const sidePicks = picks[side]
  const cmp = useMemo(() => (rot ? compare(rot, sidePicks) : { picked: [], shared: [], sharedSeconds: 0 }), [rot, sidePicks])

  if (!rotation || !rot || rot.players.length === 0) return null

  const toggle = () => {
    const next = !open
    setOpen(next)
    writeOpen(next)
  }
  const shared: Shared = {
    rotation,
    team,
    rot,
    side,
    colors,
    picks: sidePicks,
    setPicks: next => setPickMap(current => ({ ...current, [side]: next })),
    cmp,
    mineIds,
  }
  const onCourt = rot.players.filter(player => player.player.on_court).length
  const sub = phone
    ? rotation.live && rotation.now != null
      ? `${team.abbreviation} through ${clockLabel(rotation.now)} · ${onCourt} on the court`
      : `${team.abbreviation} stints · tap players to compare`
    : `When each ${team.abbreviation} player was on the floor. Pick players to see the minutes they shared.`

  return (
    <div className={`mt-4 border border-gray-200 dark:border-gray-700 ${phone ? 'rounded-xl' : 'overflow-hidden rounded-lg'}`} data-testid="rotation-card">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className={`flex min-h-14 w-full items-center text-left hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400 dark:hover:bg-gray-800 ${phone ? 'gap-2.5 rounded-xl px-3 py-2.5' : 'gap-3 px-4 py-2.5'} bg-gray-50 dark:bg-gray-800/70`}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-gray-500 transition-transform duration-150 dark:text-gray-400" style={open ? { transform: 'rotate(90deg)' } : undefined}>
          <path d="M6 3l5 5-5 5" />
        </svg>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`${phone ? 'text-[15px]' : 'text-sm'} font-semibold text-gray-900 dark:text-gray-100`}>Rotation</span>
          <span className={`${phone ? 'text-xs' : 'text-[11px]'} text-gray-500 dark:text-gray-400`}>{sub}</span>
        </span>
        <span className={`${phone ? 'text-[13px]' : 'text-xs'} font-semibold text-indigo-600 dark:text-indigo-300`}>{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div id={bodyId} className={`border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 ${phone ? 'rounded-b-xl px-2 pb-3.5 pt-3' : 'px-4 pb-4 pt-3'}`}>
          {phone ? <PhoneBody shared={shared} zoom={zoom} setZoom={setZoom} /> : <DesktopBody shared={shared} />}
        </div>
      )}
    </div>
  )
}
