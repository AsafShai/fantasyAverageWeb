import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { useGetAllPlayersQuery, useGetTeamsListQuery } from '../store/api/fantasyApi'
import { useMyTeam } from '../context/MyTeamContext'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../myTeam/display'
import { usePersistedState } from '../hooks/usePersistedState'
import TimePeriodSelector from '../components/TimePeriodSelector'
import { useMobileRedesign } from '../mobile/flag'
import { PeriodChips } from '../mobile/ui'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { getErrorMessage } from '../utils/errorMessage'
import { normalizePlayerName } from '../utils/playerName'
import { toListHeadshotUrl } from '../utils/adp'
import ShootingMapChart, { type ShootingMapChartRef } from '../components/shootingMap/ShootingMapChart'
import type { DragMode } from '../components/shootingMap/chartEngine'
import { buildShotPool, POOL_SIZE, DEFAULT_MIN_GP, type FantasyScope, type ShotScope, type ShotUnit } from '../utils/shootingMap'
import {
  AXIS_ORDER, buildChart, DEFAULT_MIN_MIN, isStatId, MODES, passesFilter, ruleOf, scoreLists, STATS,
  type ChartMeta, type ChartMode, type ChartOption, type ScatterFilter, type ScatterRow, type ScatterThresholds, type StatId,
} from '../utils/scatterMap'
import type { CustomDateRange, TimePeriod } from '../types/api'
import '../components/shootingMap/shootingMap.css'

// Site control styles (same classes as Trends / Player Rankings).
const SEG_GROUP = 'flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm'
const segBtn = (on: boolean) =>
  `flex-1 sm:flex-none px-2.5 py-2 sm:py-1.5 whitespace-nowrap ${on ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`
const FIELD = 'px-2 py-2 sm:py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm'
const CARD = 'bg-white dark:bg-gray-800 rounded-xl shadow'
const MIN_GP_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20]
const MIN_MIN_OPTIONS = [0, 5, 10, 15, 20, 25, 30]
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C']
const LIST_SIZE = 6
const ROW_LABEL = 'w-[84px] text-xs font-semibold tracking-wider uppercase text-gray-600 dark:text-gray-300'
const pill = (on: boolean) =>
  `min-h-8 px-3 rounded-full border text-[13px] font-semibold whitespace-nowrap ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`

type Pair = [StatId, StatId]
/** The chart each analysis opens with, and returns to: the pair it last showed. */
const DEFAULT_PAIRS: Record<ChartMode, Pair> = { shooting: ['FG%', 'FGA'], minute: ['MIN', 'PTS'], custom: ['STL', 'BLK'] }
const MODE_RULE: Record<ChartMode, string | null> = { shooting: 'shot', minute: 'rate', custom: null }
const samePair = (o: ChartOption, cx: StatId, cy: StatId) => (o.x === cx && o.y === cy) || (o.x === cy && o.y === cx)

/** A stored pair, or the analysis' default when it is missing or no longer fits (an older build, a renamed stat). */
function storedPair(mode: ChartMode, stored: unknown): Pair {
  const pair = (stored as Partial<Record<ChartMode, unknown>> | null)?.[mode]
  if (!Array.isArray(pair) || !isStatId(pair[0]) || !isStatId(pair[1]) || pair[0] === pair[1]) return DEFAULT_PAIRS[mode]
  const kind = MODE_RULE[mode]
  return kind === null || ruleOf(pair[0], pair[1]).kind === kind ? [pair[0], pair[1]] : DEFAULT_PAIRS[mode]
}

const fmtDay = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Seg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: [T, string][]; onChange(v: T): void
}) {
  return (
    <div className={SEG_GROUP} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} className={segBtn(value === v)} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  )
}

/** Round headshot for the side lists; desktop only (hidden on phones), like Boom or Bust's table. */
function Headshot({ playerId }: { playerId: number | null | undefined }) {
  const src = playerId != null ? toListHeadshotUrl(`https://a.espncdn.com/i/headshots/nba/players/full/${playerId}.png`) : null
  return (
    <div className="hidden md:block shrink-0 w-8 h-8 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
      {src ? (
        <>
          <img
            src={src} alt="" width={32} height={32} loading="lazy" decoding="async"
            className="w-full h-full object-cover object-top"
            onError={e => {
              e.currentTarget.style.display = 'none'
              const fallback = e.currentTarget.nextElementSibling
              if (fallback instanceof HTMLElement) fallback.hidden = false
            }}
          />
          <div hidden className="w-full h-full flex items-center justify-center text-sm">🏀</div>
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm">🏀</div>
      )}
    </div>
  )
}

/**
 * The three analyses on one row. Shooting and Per minute open a menu of their
 * charts; Custom has no menu: it opens the axis pickers on the page.
 */
function ChartPicker({ mode, cx, cy, onPick, onCustom }: {
  mode: ChartMode; cx: StatId; cy: StatId; onPick(mode: ChartMode, o: ChartOption): void; onCustom(): void
}) {
  const [open, setOpen] = useState<ChartMode | null>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(null)} />}
      <span className={ROW_LABEL}>Chart</span>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Chart">
        {MODES.map(m => {
          const on = mode === m.id, menu = m.id !== 'custom', isOpen = open === m.id
          const current = on ? (m.options.find(o => samePair(o, cx, cy))?.label ?? `${cx} × ${cy}`) : null
          return (
            <div key={m.id} className="relative">
              <button type="button" aria-pressed={on} aria-haspopup={menu ? 'menu' : undefined} aria-expanded={menu ? isOpen : undefined}
                onClick={() => { if (menu) setOpen(isOpen ? null : m.id); else { setOpen(null); onCustom() } }}
                className={`min-h-[38px] px-3.5 rounded-lg border text-sm font-semibold whitespace-nowrap ${on
                  ? 'border-blue-600 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-200'
                  : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                {m.label}{current && <span className="font-normal">: {current}</span>}
                {menu && <span aria-hidden="true" className="ml-2 text-[11px]">▾</span>}
              </button>
              {isOpen && (
                <div role="menu" aria-label={m.label}
                  className="absolute top-11 left-0 z-[21] min-w-[190px] p-1.5 flex flex-col gap-0.5 rounded-[10px] border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-xl">
                  {m.options.map(o => {
                    const sel = on && samePair(o, cx, cy)
                    return (
                      <button key={o.label} type="button" role="menuitemradio" aria-checked={sel} onClick={() => { setOpen(null); onPick(m.id, o) }}
                        className={`min-h-9 px-3 rounded-md text-left text-sm font-semibold whitespace-nowrap ${sel
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                          : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>{o.label}</button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlayerItem({ d, meta, onFocus, onRemove }: {
  d: ScatterRow; meta: ChartMeta; onFocus(key: string): void; onRemove?: (key: string) => void
}) {
  const location = useLocation()
  const id = d.player.player_id
  return (
    <li className="py-2 border-t border-gray-100 dark:border-gray-700 first:border-t-0 flex items-center gap-2.5">
      <Headshot playerId={id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <button type="button" title="Show on the map" onClick={() => onFocus(d.key)}
            className="min-w-0 truncate text-left text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
            {d.name}
          </button>
          <span className="flex items-center gap-2 shrink-0">
            <span className={`text-sm font-semibold tabular-nums ${d.z >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
              {meta.impact(d)}
            </span>
            {onRemove && (
              <button type="button" aria-label={`Remove ${d.name}`} onClick={() => onRemove(d.key)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-base leading-none">×</button>
            )}
          </span>
        </div>
        <div className="text-xs text-gray-600 dark:text-gray-400 tabular-nums mt-0.5">
          {/* Ranks are among the top 200; a team's other players get none. */}
          {d.team} · {meta.values(d)}
          {id != null && (
            <> · <Link className="text-blue-600 dark:text-blue-400 hover:underline" to={`/player/${id}`} state={{ from: `${location.pathname}${location.search}` }}>Profile</Link></>
          )}
        </div>
      </div>
    </li>
  )
}

export default function ShootingMap() {
  const mobile = useMobileRedesign()
  const [period, setPeriod] = useState<TimePeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  // Same request as Player Rankings, so the two pages share one cached fetch.
  const { data: playersData, isLoading, isFetching, error } = useGetAllPlayersQuery({
    limit: 1200,
    time_period: period,
    ...(period === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  })
  // The analysis on screen and the pair each one last showed, so coming back to one finds it as it was left.
  const [storedMode, setMode] = usePersistedState<ChartMode>('shootingMap.chart', 'shooting')
  const [storedPairs, setPairs] = usePersistedState<Record<ChartMode, Pair>>('shootingMap.pairs', DEFAULT_PAIRS)
  const mode: ChartMode = MODES.some(m => m.id === storedMode) ? storedMode : 'shooting'
  const [cx, cy] = useMemo(() => storedPair(mode, storedPairs), [mode, storedPairs])
  const [unit, setUnitState] = usePersistedState<ShotUnit>('shootingMap.unit', 'pg')
  // Threshold boxes hold what was typed ('' = no floor); they mean nothing on
  // another pair of axes or in another unit, so switching either clears them.
  const [minXText, setMinXText] = useState('')
  const [minYText, setMinYText] = useState('')
  const [filter, setFilter] = useState<ScatterFilter>('all')
  const clearThresholds = () => { setMinXText(''); setMinYText('') }
  /** Show a pair of stats, and remember it for its analysis. */
  const setPair = (x: StatId, y: StatId, m: ChartMode = mode) => {
    setMode(m)
    setPairs({ shooting: storedPair('shooting', storedPairs), minute: storedPair('minute', storedPairs), custom: storedPair('custom', storedPairs), [m]: [x, y] })
    clearThresholds()
    setFilter('all')
  }
  /** Put a stat on one axis; picking the stat the other axis already shows swaps the two. */
  const pickAxis = (axis: 0 | 1, id: StatId) => {
    const mine = axis === 0 ? cx : cy, other = axis === 0 ? cy : cx
    const moved = other === id ? mine : other
    if (axis === 0) setPair(id, moved)
    else setPair(moved, id)
  }
  const setUnit = (u: ShotUnit) => { setUnitState(u); clearThresholds() }
  const [positions, setPositions] = useState<string[]>([])
  const [dragMode, setDragMode] = useState<DragMode>('pan')
  const [minMin, setMinMin] = usePersistedState('shootingMap.minMin', DEFAULT_MIN_MIN)
  const [minGp, setMinGp] = usePersistedState('shootingMap.minGp', DEFAULT_MIN_GP)
  const [searchParams, setSearchParams] = useSearchParams()
  const teamParam = searchParams.get('team')?.toUpperCase() ?? null
  const fantasyParam = parseFantasyParam(searchParams.get('fteam'))
  const { data: fantasyTeams } = useGetTeamsListQuery()
  const { myTeamId, isMyTeam } = useMyTeam()
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [searchMiss, setSearchMiss] = useState(false)
  const chartRef = useRef<ShootingMapChartRef>(null)

  const reverseKey = (playersData?.reverse_categories ?? []).join(',')
  const shotPool = useMemo(() => {
    const players = playersData?.players ?? []
    const cats = playersData?.categories?.length ? playersData.categories : undefined
    return buildShotPool(players, cats, new Set(reverseKey ? reverseKey.split(',') : []), minGp)
  }, [playersData?.players, playersData?.categories, reverseKey, minGp])

  const teams = useMemo(
    () => [...new Set(shotPool.eligible.map(p => p.pro_team).filter(t => t && t !== 'FA'))].sort(),
    [shotPool],
  )
  // An unknown ?team= / ?fteam= (typo, old link) falls back to every team.
  const team = teamParam && teams.includes(teamParam) ? teamParam : null
  const fantasy: FantasyScope = typeof fantasyParam === 'number' && fantasyParam !== 0 && fantasyTeams
    && !fantasyTeams.some(t => t.team_id === fantasyParam) ? null : fantasyParam
  const hasMin = cx === 'MIN' || cy === 'MIN'
  // The chart depends on the teams (a picked team adds its players outside the top 200) but not on the positions, which only dim dots.
  const chart = useMemo(
    () => buildChart(shotPool, cx, cy, unit, { nba: team, fantasy }, minMin),
    [shotPool, cx, cy, unit, team, fantasy, minMin],
  )
  const { data, view, meta: M, rule } = chart
  const scope = useMemo<ShotScope>(() => ({ nba: team, fantasy, positions }), [team, fantasy, positions])

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const remove = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }
  const focus = (key: string) => {
    setSelected(prev => (prev.has(key) ? prev : new Set(prev).add(key)))
    // Let the selection reach the chart first, then zoom to the player.
    requestAnimationFrame(() => chartRef.current?.focus(key))
    // Stacked layout (phones): the lists sit under the map, so bring it into view.
    if (window.matchMedia?.('(max-width: 900px)').matches) {
      document.querySelector('.sm-chartbox')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    }
  }

  const setParam = (key: 'team' | 'fteam', value: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value)
      else next.delete(key)
      return next
    }, { replace: true })
  }

  const minX = parseThreshold(minXText), minY = parseThreshold(minYText)
  const scaleX = M.th1.scale, scaleY = M.th2.scale
  const thresholds = useMemo<ScatterThresholds>(
    () => ({ minX: minX === null ? null : minX * scaleX, minY: minY === null ? null : minY * scaleY }),
    [minX, minY, scaleX, scaleY],
  )
  const chartInput = useMemo(() => ({ rows: data.rows, view, meta: M, filter, scope, thresholds, selected, dragMode }),
    [data, view, M, filter, scope, thresholds, selected, dragMode])
  const viewKey = `${cx}|${cy}|${chart.unit}|${period}|${customRange?.start ?? ''}|${customRange?.end ?? ''}|${team ?? ''}|${fantasy ?? ''}|${minGp}|${hasMin ? minMin : ''}`

  const byKey = useMemo(() => new Map(data.rows.map(d => [d.key, d])), [data])
  const selectedRows = [...selected].map(k => byKey.get(k)).filter((d): d is ScatterRow => d !== undefined)
  const listed = useMemo(() => data.rows.filter(d => passesFilter(d, view, 'all', scope, thresholds)), [data, view, scope, thresholds])
  const { top, bottom } = useMemo(() => scoreLists(listed, LIST_SIZE), [listed])

  const trySearch = (raw: string) => {
    const v = normalizePlayerName(raw.trim())
    if (!v) return
    const rows = data.rows
    const hit = rows.find(d => normalizePlayerName(d.name) === v) ?? rows.find(d => normalizePlayerName(d.name).includes(v))
    if (hit) {
      focus(hit.key)
      setQuery('')
    }
    setSearchMiss(!hit)
  }

  const fantasyName = fantasyScopeLabel(fantasy, fantasyTeams ?? [])
  // "BOS · Roy's Rowdy Team": what the lists and header are narrowed to.
  const scopeLabel = [team, fantasyName].filter(Boolean).join(' · ')
  const categoryCount = playersData?.categories?.length || 8
  const end = playersData?.actual_end
  const start = playersData?.actual_start
  const season = seasonLabel(end)
  const span = period === 'season' ? (end ? `Through ${fmtDay(end)}` : 'Season') : start && end ? `${fmtDay(start)} – ${fmtDay(end)}` : ''

  const listCard = (title: string, rows: ScatterRow[], empty: string, removable = false) => (
    <div className={`${CARD} p-4`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h2>
      {rows.length > 0 ? (
        <ul>
          {rows.map(d => <PlayerItem key={d.key} d={d} meta={M} onFocus={focus} onRemove={removable ? remove : undefined} />)}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      )}
    </div>
  )
  const scoped = scopeLabel ? ` · ${scopeLabel}` : ''

  // What the page says about the chart on screen.
  const rates = rule.kind === 'rate', custom = rule.kind === 'z'
  const shot = rule.kind === 'shot' ? rule.chart : null
  const scouting = shot?.points ?? false
  const scoredIds = [cx, cy].filter(id => !STATS[id].volume)
  const gamesText = `${minGp} ${minGp === 1 ? 'game' : 'games'}`
  const when = `${season ? ` · NBA ${season}` : ''}${span ? ` · ${span}` : ''}${scoped}`
  const ruleText = rule.kind === 'rate' ? `${rule.stat} per minute (greener = more per minute)`
    : rule.kind === 'shot' ? (scouting ? 'points above or below an average scorer on the same shots' : `${rule.chart.made} above or below average on the player's own attempts`)
    : scoredIds.length === 2 ? 'average of the two z-scores (greener = higher across the two)'
    : scoredIds.length === 1 ? `${scoredIds[0]} only (attempts and minutes are volume, they do not change the color)`
    : 'none (attempts and minutes are volume, so every dot is gray)'
  const subtitle = rule.kind === 'rate'
    ? `${rule.stat} against minutes per game for the ${data.rows.length} players with at least ${minMin} minutes per game and ${gamesText}${when}. Greener means more ${rule.stat} per minute.`
    : rule.kind === 'shot'
      ? `${rule.chart.pct} against ${scouting ? 'points' : 'attempts'} for the top ${POOL_SIZE} fantasy players${when}. ${scouting
        ? 'TS% is not a league category: this is a scouting view of scoring efficiency. Color shows points above or below what an average scorer gets on the same shots.'
        : 'Color shows how many makes above or below the pool average a player adds.'}`
      : `${cx} against ${cy}, per game, for the top ${POOL_SIZE} fantasy players${hasMin ? ` with at least ${minMin} minutes per game` : ''}${when}. ${scoredIds.length === 2
        ? 'Greener means a better average of the two z-scores.'
        : scoredIds.length === 1 ? `Greener means more ${scoredIds[0]}; ${cx === scoredIds[0] ? cy : cx} is volume and does not change the color.`
        : 'Both are volume (how much a player plays or shoots), so the dots have no color.'}`
  const emptyText = hasMin
    ? `No players with at least ${gamesText} and ${minMin} minutes per game in this period.`
    : `No players with at least ${gamesText} in this period yet.`
  const chips: [ScatterFilter, string | null][] = [['all', 'All'], ['x', M.words.chipX], ['y', M.words.chipY], ['both', 'Above avg in both'], ['good', M.words.chipGood]]
  const thresholdBox = (th: ChartMeta['th1'], text: string, setText: (v: string) => void) => (
    <label className="flex items-center gap-1.5">
      <span>{th.label} ≥</span>
      <input type="number" inputMode="decimal" min={0} max={th.suffix === '%' ? 100 : undefined} step={th.step} placeholder="any"
        className={`${FIELD} w-16 text-center`}
        aria-label={`Minimum ${th.label}${th.suffix === '/g' ? ' per game' : ''}`} value={text} onChange={e => setText(e.target.value)} />
      {th.suffix && <span className="text-gray-500 dark:text-gray-400">{th.suffix}</span>}
    </label>
  )

  return (
    <div className="sm-root min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">🎯 Player Scatter Map</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400" aria-hidden="true">
            <span>{M.words.low}</span><span className="sm-ramp" /><span>{M.words.high}</span>
          </div>
        </div>

        <section className={`${CARD} px-4 py-3.5 mb-4 flex flex-col gap-2.5`} aria-label="Chart">
          <ChartPicker mode={mode} cx={cx} cy={cy} onPick={(m, o) => setPair(o.x, o.y, m)}
            onCustom={() => { const [x, y] = storedPair('custom', storedPairs); setPair(x, y, 'custom') }} />
          {mode === 'custom' && (
            <>
              {([[0, 'X axis', cx], [1, 'Y axis', cy]] as [0 | 1, string, StatId][]).map(([axis, title, value]) => (
                <div key={title} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className={ROW_LABEL}>{title}</span>
                  <div className="flex max-w-full overflow-x-auto rounded-lg border border-gray-300 dark:border-gray-600 text-sm" role="group" aria-label={title}>
                    {AXIS_ORDER.map(id => (
                      <button key={id} type="button" aria-pressed={value === id} onClick={() => pickAxis(axis, id)}
                        className={`min-w-[52px] px-3 py-[7px] whitespace-nowrap font-semibold ${value === id ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>{id}</button>
                    ))}
                  </div>
                  <span className="text-sm text-gray-600 dark:text-gray-300">{STATS[value].name}{STATS[value].kind === 'pct' ? '' : ' per game'}</span>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <button type="button" onClick={() => setPair(cy, cx)}
                  className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600 text-[13px]">Swap axes</button>
                <span className="text-[13px] text-gray-600 dark:text-gray-300">Ideas:</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ideas">
                  {MODES[2].options.map(o => (
                    <button key={o.label} type="button" aria-pressed={samePair(o, cx, cy)} className={pill(samePair(o, cx, cy))} onClick={() => setPair(o.x, o.y)}>{o.label}</button>
                  ))}
                </div>
              </div>
            </>
          )}
          <p className="text-[13px] text-gray-600 dark:text-gray-300"><span className="font-semibold text-gray-900 dark:text-gray-100">Color:</span> {ruleText}</p>
        </section>

        <div className={`${CARD} p-4 mb-6`} role="toolbar" aria-label="Display options">
          <div className="flex flex-wrap items-center gap-2">
            {shot && <Seg<ShotUnit> label="Units" value={unit} onChange={setUnit} options={[['pg', 'Per game'], ['tot', 'Totals']]} />}
            <div className={`${SEG_GROUP} max-w-full overflow-x-auto [scrollbar-width:none]`} role="group" aria-label="Filter">
              {chips.map(([key, label]) => label && (
                <button key={key} type="button" aria-pressed={filter === key} className={segBtn(filter === key)} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <label htmlFor="sm-team" className="sr-only">NBA team</label>
            <select id="sm-team" className={`${FIELD} min-w-0 basis-[calc(50%-4px)] sm:basis-auto`} value={team ?? ''} onChange={e => setParam('team', e.target.value)}>
              <option value="">All NBA teams</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label htmlFor="sm-fteam" className="sr-only">Fantasy team</label>
            <select id="sm-fteam" className={`${FIELD} min-w-0 basis-[calc(50%-4px)] sm:basis-auto sm:max-w-[200px]`} value={fantasyParamValue(fantasy)}
              onChange={e => setParam('fteam', e.target.value)}>
              <option value="">All fantasy teams</option>
              <option value="rostered">Rostered</option>
              <option value="fa">Free agents / waivers</option>
              {leadWithMyTeam(fantasyTeams ?? [], myTeamId).map(t => (
                <option key={t.team_id} value={t.team_id}>{fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id))}</option>
              ))}
            </select>
            <div className="flex items-center gap-2 text-xs sm:text-sm text-gray-600 dark:text-gray-300" role="group" aria-label="Positions">
              <span>Position</span>
              {/* Any of the picked positions; none picked means everyone. */}
              <div className={SEG_GROUP}>
                {POSITIONS.map(pos => {
                  const on = positions.includes(pos)
                  return (
                    <button key={pos} type="button" aria-pressed={on} className={`${segBtn(on)} min-w-10 font-semibold`}
                      onClick={() => setPositions(on ? positions.filter(x => x !== pos) : [...positions, pos])}>{pos}</button>
                  )
                })}
              </div>
            </div>
            <div className="relative w-full sm:w-auto">
              <label htmlFor="sm-q" className="sr-only">Find a player</label>
              <input
                id="sm-q" list="sm-names" placeholder="Search player…" autoComplete="off" value={query}
                className={`${FIELD} w-full sm:min-w-[170px]`}
                onChange={e => {
                  setQuery(e.target.value)
                  setSearchMiss(false)
                  // Picking from the datalist fills the exact name: jump straight to it.
                  if (byNameExact(data.rows, e.target.value)) trySearch(e.target.value)
                }}
                onKeyDown={e => { if (e.key === 'Enter') trySearch(query) }}
              />
              {searchMiss && <div className="absolute left-2 top-full mt-0.5 text-xs text-red-600 dark:text-red-400" role="status">No player found</div>}
              <datalist id="sm-names">
                {data.rows.map(d => <option key={d.key} value={d.name} />)}
              </datalist>
            </div>
            <label className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
              <span>Min games</span>
              <select className={FIELD} value={minGp} onChange={e => setMinGp(Number(e.target.value))}
                title="Fewest games in the selected period">
                {(MIN_GP_OPTIONS.includes(minGp) ? MIN_GP_OPTIONS : [...MIN_GP_OPTIONS, minGp].sort((a, b) => a - b))
                  .map(n => <option key={n} value={n}>{n}+</option>)}
              </select>
            </label>
            {hasMin && (
              <label className="flex items-center gap-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                <span>Min minutes per game</span>
                <select className={FIELD} value={minMin} onChange={e => setMinMin(Number(e.target.value))}>
                  {(MIN_MIN_OPTIONS.includes(minMin) ? MIN_MIN_OPTIONS : [...MIN_MIN_OPTIONS, minMin].sort((a, b) => a - b))
                    .map(n => <option key={n} value={n}>{n === 0 ? 'Any' : `${n}+`}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="mt-3">
            {mobile ? (
              <PeriodChips value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
            ) : (
              <TimePeriodSelector value={period} onChange={setPeriod} customRange={customRange} onCustomRangeChange={setCustomRange} />
            )}
          </div>
        </div>

        {error ? (
          <ErrorMessage message={getErrorMessage(error, 'Failed to load players.')} />
        ) : isLoading ? (
          <div className="py-16"><LoadingSpinner /></div>
        ) : data.rows.length === 0 ? (
          <div className={`${CARD} p-8 text-center text-sm text-gray-600 dark:text-gray-400`}>{emptyText}</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start" style={{ opacity: isFetching ? 0.6 : 1 }}>
            <ShootingMapChart
              ref={chartRef} input={chartInput} viewKey={viewKey} onToggle={toggle} onDragMode={setDragMode}
              toolbar={(
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300" role="group" aria-label="Thresholds">
                  {thresholdBox(M.th1, minXText, setMinXText)}
                  {thresholdBox(M.th2, minYText, setMinYText)}
                  {(minX !== null || minY !== null) && (
                    <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline" onClick={clearThresholds}>Clear</button>
                  )}
                </div>
              )}
            />
            <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="sm:col-span-2 lg:col-span-1">
                {listCard('Pinned players', selectedRows, 'Click a dot or search for a player to pin them. Pinned players stay labeled on the map.', true)}
              </div>
              {listCard(`${M.words.best}${scoped}`, top, 'No players to show.')}
              {listCard(`${M.words.worst}${scoped}`, bottom, 'No other players to show.')}
            </aside>
          </div>
        )}

        <div className="mt-6 space-y-2 text-xs text-gray-600 dark:text-gray-400 max-w-4xl">
          {rates ? (
            <>
              <p>
                Every player with at least {minMin} minutes per game and {gamesText} in the selected period is on the map (change both with
                Min minutes per game and Min games). Averages, colors and ranks come from those players.
              </p>
              <p>
                Per-minute value = {rule.stat} per 36 minutes. Every player on one dashed line produces the same per minute: the gray line is the
                pool average, green and red are 1 and 2 standard deviations above and below it. A dot high on the left is a player who
                produces a lot in few minutes.
              </p>
            </>
          ) : (
            <>
              <p>
                "Top {POOL_SIZE}" = the {categoryCount}-category z-score ranking (same as Player Rankings, per game, equal weights) for the
                selected period, minimum {gamesText} (change it with Min games). Averages, the colors and the ranks always come from those {POOL_SIZE} players;
                picking an NBA or fantasy team also shows that team's other players, measured against the same pool.
              </p>
              {custom ? (
                <p>
                  Each stat becomes a z-score: how many standard deviations a player is above or below the average of the top {POOL_SIZE}.
                  {scoredIds.length === 2
                    ? ' The color is the average of the two z-scores, so a player strong in both is the greenest.'
                    : ' Attempts and minutes are volume: more of them is not better, so they are on the chart but not in the color.'}
                  {M.lines && ' Every player on one dashed line has the same average z-score: the gray line is the pool average, green is above it and red below.'}
                  {(STATS[cx].kind === 'pct' || STATS[cy].kind === 'pct')
                    && ' A percentage is scored as in Player Rankings: makes above the pool percentage on the player\'s own attempts, so a good percentage on many attempts counts more than on few.'}
                  {(STATS[cx].kind === 'impact' || STATS[cy].kind === 'impact')
                    && ' FG Imp / FT Imp = makes minus (average % × attempts), per game: the shooting charts\' impact as a stat of its own.'}
                </p>
              ) : shot && (
                <p>
                  {scouting
                    ? 'TS% = points / (2 × (FGA + 0.44 × FTA)). Points vs. average = points minus what an average scorer gets from the same attempts.'
                    : 'Impact = makes minus (average % × attempts): how many extra makes a player brings to the category.'}
                  {' '}The dashed curves join players with equal impact (±1 and ±2 standard deviations); the straight lines are the pool averages.
                  Players with no attempts are left out. Percentage ranks need {shot.minRank} {shot.att} per game.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A threshold box's number, or null when empty or not a number. */
function parseThreshold(text: string): number | null {
  if (text.trim() === '') return null
  const v = Number(text)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** ?fteam=: a fantasy team id, "fa" (free agents / waivers) or "rostered". */
function parseFantasyParam(raw: string | null): FantasyScope {
  if (raw === 'rostered') return 'rostered'
  if (raw === 'fa') return 0
  const id = raw ? Number(raw) : NaN
  return Number.isInteger(id) && id > 0 ? id : null
}

function fantasyParamValue(scope: FantasyScope): string {
  if (scope === null) return ''
  if (scope === 0) return 'fa'
  return String(scope)
}

function fantasyScopeLabel(scope: FantasyScope, teams: { team_id: number; team_name: string }[]): string | null {
  if (scope === null) return null
  if (scope === 'rostered') return 'Rostered'
  if (scope === 0) return 'Free agents'
  return teams.find(t => t.team_id === scope)?.team_name ?? null
}

/** "2026–27" for a date in that season (seasons start in October). */
function seasonLabel(day: string | undefined): string | null {
  if (!day) return null
  const [y, m] = day.split('-').map(Number)
  const start = m >= 8 ? y : y - 1
  return `${start}–${String(start + 1).slice(2)}`
}

function byNameExact(rows: ScatterRow[], value: string): boolean {
  const v = normalizePlayerName(value.trim())
  return v !== '' && rows.some(d => normalizePlayerName(d.name) === v)
}
