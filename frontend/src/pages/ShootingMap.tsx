import { useMemo, useRef, useState } from 'react'
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
import ShootingMapChart, { type ShootingMapChartRef } from '../components/shootingMap/ShootingMapChart'
import {
  buildShotPool, deriveShotData, impactLists, passesFilter, shotLabels, POOL_SIZE, DEFAULT_MIN_GP, EXTRA_MIN_FGA, EXTRA_MIN_FTA, signedImpact, inScope, isScoped, type ShotThresholds,
  type FantasyScope, type ShotFilter, type ShotMode, type ShotScope, type ShotRow, type ShotUnit,
} from '../utils/shootingMap'
import type { CustomDateRange, TimePeriod } from '../types/api'
import '../components/shootingMap/shootingMap.css'

// Site control styles (same classes as Trends / Player Rankings).
const SEG_GROUP = 'flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-xs sm:text-sm'
const segBtn = (on: boolean) =>
  `flex-1 sm:flex-none px-2.5 py-2 sm:py-1.5 whitespace-nowrap ${on ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`
const FIELD = 'px-2 py-2 sm:py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm'
const CARD = 'bg-white dark:bg-gray-800 rounded-xl shadow'
const MIN_GP_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20]

const filterChips = (mode: ShotMode): { key: ShotFilter; label: string }[] => {
  const L = shotLabels(mode)
  return [
    { key: 'all', label: 'All' },
    { key: 'pct', label: `Above-avg ${L.pct}` },
    { key: 'vol', label: `Above-avg ${L.att}` },
    { key: 'both', label: 'Above avg in both' },
    { key: 'imp', label: `Helps ${L.pct}` },
  ]
}
const LIST_SIZE = 6

const fmtPct = (v: number) => (v * 100).toFixed(1) + '%'
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

function PlayerItem({ d, unit, mode, onFocus, onRemove }: {
  d: ShotRow; unit: ShotUnit; mode: ShotMode; onFocus(key: string): void; onRemove?: (key: string) => void
}) {
  const location = useLocation()
  const L = shotLabels(mode)
  const n = (v: number) => (unit === 'tot' ? Math.round(v).toString() : v.toFixed(1))
  const id = d.player.player_id
  return (
    <li className="py-2 border-t border-gray-100 dark:border-gray-700 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <button type="button" title="Show on the map" onClick={() => onFocus(d.key)}
          className="min-w-0 truncate text-left text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400">
          {d.name}
        </button>
        <span className="flex items-center gap-2 shrink-0">
          <span className={`text-sm font-semibold tabular-nums ${d.imp >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {signedImpact(d.imp, unit)}
          </span>
          {onRemove && (
            <button type="button" aria-label={`Remove ${d.name}`} onClick={() => onRemove(d.key)}
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-base leading-none">×</button>
          )}
        </span>
      </div>
      <div className="text-xs text-gray-500 dark:text-gray-400 tabular-nums mt-0.5">
        {/* Ranks are among the top 200; a team's other players get none. */}
        {d.team} · {fmtPct(d.pct)} {L.pct}{d.inPool && d.rPct ? ` (#${d.rPct})` : ''} · {n(d.a)} {L.att}{d.inPool ? ` (#${d.rVol})` : ''}
        {id != null && (
          <> · <Link className="text-blue-600 dark:text-blue-400 hover:underline" to={`/player/${id}`} state={{ from: `${location.pathname}${location.search}` }}>Profile</Link></>
        )}
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
  const [mode, setModeState] = usePersistedState<ShotMode>('shootingMap.mode', 'fg')
  const [unit, setUnitState] = usePersistedState<ShotUnit>('shootingMap.unit', 'pg')
  // Threshold boxes hold what was typed ('' = no floor); they mean nothing in
  // another shot type or unit, so switching either clears them.
  const [minPctText, setMinPctText] = useState('')
  const [minAttText, setMinAttText] = useState('')
  const setMode = (m: ShotMode) => { setModeState(m); setMinPctText(''); setMinAttText('') }
  const setUnit = (u: ShotUnit) => { setUnitState(u); setMinAttText('') }
  const [filter, setFilter] = useState<ShotFilter>('all')
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
  const scope = useMemo<ShotScope>(() => ({ nba: team, fantasy }), [team, fantasy])
  // A picked team also shows its players outside the top 200, measured against it.
  const extra = useMemo(() => {
    if (!isScoped(scope)) return []
    const inPool = new Set(shotPool.pool)
    return shotPool.eligible.filter(p => inScope(p, scope) && !inPool.has(p))
  }, [shotPool, scope])
  const data = useMemo(
    () => deriveShotData(shotPool.pool, extra, shotPool.frank, mode, unit),
    [shotPool, extra, mode, unit],
  )

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

  const minPct = parseThreshold(minPctText)
  const minAtt = parseThreshold(minAttText)
  const thresholds = useMemo<ShotThresholds>(() => ({ minPct: minPct === null ? null : minPct / 100, minAtt }), [minPct, minAtt])
  const chartInput = useMemo(() => ({ data, mode, unit, filter, scope, thresholds, selected }),
    [data, mode, unit, filter, scope, thresholds, selected])
  const viewKey = `${mode}|${unit}|${period}|${customRange?.start ?? ''}|${customRange?.end ?? ''}|${team ?? ''}|${fantasy ?? ''}|${minGp}`

  const byKey = useMemo(() => new Map(data.rows.map(d => [d.key, d])), [data])
  const selectedRows = [...selected].map(k => byKey.get(k)).filter((d): d is ShotRow => d !== undefined)
  const listed = useMemo(() => data.rows.filter(d => passesFilter(d, data, 'all', scope, thresholds)), [data, scope, thresholds])
  const { top, bottom } = useMemo(() => impactLists(listed, LIST_SIZE), [listed])

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

  const L = shotLabels(mode)
  const fantasyName = fantasyScopeLabel(fantasy, fantasyTeams ?? [])
  // "BOS · Roy's Rowdy Team": what the lists and header are narrowed to.
  const scopeLabel = [team, fantasyName].filter(Boolean).join(' · ')
  const categoryCount = playersData?.categories?.length || 8
  const end = playersData?.actual_end
  const start = playersData?.actual_start
  const season = seasonLabel(end)
  const span = period === 'season' ? (end ? `Through ${fmtDay(end)}` : 'Season') : start && end ? `${fmtDay(start)} – ${fmtDay(end)}` : ''

  const listCard = (title: string, rows: ShotRow[], empty: string, removable = false) => (
    <div className={`${CARD} p-4`}>
      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">{title}</h2>
      {rows.length > 0 ? (
        <ul>
          {rows.map(d => <PlayerItem key={d.key} d={d} unit={unit} mode={mode} onFocus={focus} onRemove={removable ? remove : undefined} />)}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 dark:text-gray-400">{empty}</p>
      )}
    </div>
  )
  const scoped = scopeLabel ? ` · ${scopeLabel}` : ''

  return (
    <div className="sm-root min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">🎯 Player Shooting Map</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Shooting % against attempts for the top {POOL_SIZE} fantasy players{season ? ` · NBA ${season}` : ''}{span ? ` · ${span}` : ''}{scoped}.
              Color shows how many makes above or below the pool average a player adds.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" aria-hidden="true">
            <span>Hurts</span><span className="sm-ramp" /><span>Helps</span>
          </div>
        </div>

        <div className={`${CARD} p-4 mb-6`} role="toolbar" aria-label="Display options">
          <div className="flex flex-wrap items-center gap-2">
            <Seg<ShotMode> label="Shot type" value={mode} onChange={setMode} options={[['fg', 'FG%'], ['ft', 'FT%']]} />
            <Seg<ShotUnit> label="Units" value={unit} onChange={setUnit} options={[['pg', 'Per game'], ['tot', 'Totals']]} />
            <div className={`${SEG_GROUP} max-w-full overflow-x-auto [scrollbar-width:none]`} role="group" aria-label="Filter">
              {filterChips(mode).map(f => (
                <button key={f.key} type="button" aria-pressed={filter === f.key} className={segBtn(filter === f.key)} onClick={() => setFilter(f.key)}>{f.label}</button>
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
          <div className={`${CARD} p-8 text-center text-sm text-gray-500 dark:text-gray-400`}>No players with at least {minGp} games in this period yet.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start" style={{ opacity: isFetching ? 0.6 : 1 }}>
            <ShootingMapChart
              ref={chartRef} input={chartInput} viewKey={viewKey} onToggle={toggle}
              toolbar={(
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300" role="group" aria-label="Thresholds">
                  <label className="flex items-center gap-1.5">
                    <span>{L.pct} ≥</span>
                    <input type="number" inputMode="decimal" min={0} max={100} step={1} placeholder="any"
                      className={`${FIELD} w-16 text-center`}
                      aria-label={`Minimum ${L.pct}`} value={minPctText} onChange={e => setMinPctText(e.target.value)} />
                    <span className="text-gray-400">%</span>
                  </label>
                  <label className="flex items-center gap-1.5">
                    <span>{L.att} ≥</span>
                    <input type="number" inputMode="decimal" min={0} step={unit === 'tot' ? 5 : 0.5} placeholder="any"
                      className={`${FIELD} w-16 text-center`}
                      aria-label={`Minimum ${L.att}${unit === 'pg' ? ' per game' : ''}`} value={minAttText} onChange={e => setMinAttText(e.target.value)} />
                    {unit === 'pg' && <span className="text-gray-400">/g</span>}
                  </label>
                  {(minPct !== null || minAtt !== null) && (
                    <button type="button" className="text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => { setMinPctText(''); setMinAttText('') }}>Clear</button>
                  )}
                </div>
              )}
            />
            <aside className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <div className="sm:col-span-2 lg:col-span-1">
                {listCard('Pinned players', selectedRows, 'Click a dot or search for a player to pin them. Pinned players stay labeled on the map.', true)}
              </div>
              {listCard(`Best for ${L.pct}${scoped}`, top, 'No players to show.')}
              {listCard(`Worst for ${L.pct}${scoped}`, bottom, 'No other players to show.')}
            </aside>
          </div>
        )}

        <div className="mt-6 space-y-2 text-xs text-gray-500 dark:text-gray-400 max-w-4xl">
          <p>
            "Top {POOL_SIZE}" = the {categoryCount}-category z-score ranking (same as Player Rankings, per game, equal weights) for the
            selected period, minimum {minGp} {minGp === 1 ? 'game' : 'games'} (change it with Min games). Averages, the colors and the ranks always come from those {POOL_SIZE} players;
            picking an NBA or fantasy team also shows that team's other players (at least {EXTRA_MIN_FGA} FGA / {EXTRA_MIN_FTA} FTA per game),
            measured against the same pool.
          </p>
          <p>
            Impact = makes minus (average % × attempts): how many extra makes a player brings to the category. The dashed curves
            join players with equal impact (±1 and ±2 standard deviations); the straight lines are the pool averages.
            Players with no attempts are left out. Percentage ranks need {mode === 'fg' ? '5 FGA' : '1.5 FTA'} per game.
          </p>
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

function byNameExact(rows: ShotRow[], value: string): boolean {
  const v = normalizePlayerName(value.trim())
  return v !== '' && rows.some(d => normalizePlayerName(d.name) === v)
}
