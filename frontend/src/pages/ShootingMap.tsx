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
import ShootingMapChart, { type ShootingMapChartRef } from '../components/shootingMap/ShootingMapChart'
import {
  buildShotPool, deriveShotData, impactLists, passesFilter, shotLabels, POOL_SIZE, DEFAULT_MIN_GP, EXTRA_MIN_FGA, EXTRA_MIN_FTA, signedImpact, inScope, isScoped,
  type FantasyScope, type ShotFilter, type ShotMode, type ShotScope, type ShotRow, type ShotUnit,
} from '../utils/shootingMap'
import type { CustomDateRange, TimePeriod } from '../types/api'
import '../components/shootingMap/shootingMap.css'

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap'

/** The page's condensed display face; loaded only when someone opens it. */
function ensureShootingMapFonts() {
  if (typeof document === 'undefined' || document.getElementById('sm-fonts')) return
  const link = document.createElement('link')
  link.id = 'sm-fonts'
  link.rel = 'stylesheet'
  link.href = FONT_HREF
  document.head.appendChild(link)
}

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
    <div className="sm-seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
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
    <li>
      <button type="button" className="sm-nm" title="Show on the map" onClick={() => onFocus(d.key)}>{d.name}</button>
      <span className="sm-right">
        <span className={`sm-imp ${d.imp >= 0 ? 'sm-pos' : 'sm-neg'}`}>{signedImpact(d.imp, unit)}</span>
        {onRemove && (
          <button type="button" className="sm-x" aria-label={`Remove ${d.name}`} onClick={() => onRemove(d.key)}>×</button>
        )}
      </span>
      <div className="sm-meta">
        {/* Ranks are among the top 200; a team's other players get none. */}
        {d.team} · {fmtPct(d.pct)} {L.pct}{d.inPool && d.rPct ? ` (#${d.rPct})` : ''} · {n(d.a)} {L.att}{d.inPool ? ` (#${d.rVol})` : ''}
        {id != null && (
          <> · <Link className="sm-profile" to={`/player/${id}`} state={{ from: `${location.pathname}${location.search}` }}>Profile</Link></>
        )}
      </div>
    </li>
  )
}

export default function ShootingMap() {
  useEffect(ensureShootingMapFonts, [])
  const mobile = useMobileRedesign()
  const [period, setPeriod] = useState<TimePeriod>('season')
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null)
  // Same request as Player Rankings, so the two pages share one cached fetch.
  const { data: playersData, isLoading, isFetching, error } = useGetAllPlayersQuery({
    limit: 1200,
    time_period: period,
    ...(period === 'custom' && customRange ? { start: customRange.start, end: customRange.end } : {}),
  })
  const [mode, setMode] = usePersistedState<ShotMode>('shootingMap.mode', 'fg')
  const [unit, setUnit] = usePersistedState<ShotUnit>('shootingMap.unit', 'pg')
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

  const chartInput = useMemo(() => ({ data, mode, unit, filter, scope, selected }), [data, mode, unit, filter, scope, selected])
  const viewKey = `${mode}|${unit}|${period}|${customRange?.start ?? ''}|${customRange?.end ?? ''}|${team ?? ''}|${fantasy ?? ''}|${minGp}`

  const byKey = useMemo(() => new Map(data.rows.map(d => [d.key, d])), [data])
  const selectedRows = [...selected].map(k => byKey.get(k)).filter((d): d is ShotRow => d !== undefined)
  const listed = useMemo(() => data.rows.filter(d => passesFilter(d, data, 'all', scope)), [data, scope])
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

  return (
    <div className="sm-root">
      <div className="sm-wrap">
        <header className="sm-header">
          <div>
            <div className="sm-lbl">NBA{season ? ` ${season}` : ''} {span ? `· ${span} ` : ''}· Top {POOL_SIZE} fantasy players{scopeLabel ? ` · ${scopeLabel}` : ''}</div>
            <h1 className="sm-h1">Player Shooting Map</h1>
            <div className="sm-sub">
              Shooting % across, attempts up. Color shows how many makes above or below the pool average a player adds:{' '}
              <b>orange helps</b>, <span className="sm-cold">blue hurts</span>.
            </div>
          </div>
          <div className="sm-legend"><span>Hurts</span><span className="sm-ramp" aria-hidden="true" /><span>Helps</span></div>
        </header>

        <div className="sm-controls" role="toolbar" aria-label="Display options">
          <Seg<ShotMode> label="Shot type" value={mode} onChange={setMode} options={[['fg', 'FG%'], ['ft', 'FT%']]} />
          <Seg<ShotUnit> label="Units" value={unit} onChange={setUnit} options={[['pg', 'Per game'], ['tot', 'Totals']]} />
          <div className="sm-chips" role="group" aria-label="Filter">
            {filterChips(mode).map(f => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          <div className="sm-field">
            <label htmlFor="sm-team" className="sm-sr">NBA team</label>
            <select id="sm-team" className={team ? 'sm-on' : ''} value={team ?? ''} onChange={e => setParam('team', e.target.value)}>
              <option value="">All NBA teams</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="sm-field">
            <label htmlFor="sm-fteam" className="sm-sr">Fantasy team</label>
            <select id="sm-fteam" className={fantasy !== null ? 'sm-on' : ''} value={fantasyParamValue(fantasy)}
              onChange={e => setParam('fteam', e.target.value)}>
              <option value="">All fantasy teams</option>
              <option value="rostered">Rostered</option>
              <option value="fa">Free agents / waivers</option>
              {leadWithMyTeam(fantasyTeams ?? [], myTeamId).map(t => (
                <option key={t.team_id} value={t.team_id}>{fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id))}</option>
              ))}
            </select>
          </div>
          <div className="sm-field">
            <label htmlFor="sm-q" className="sm-sr">Find a player</label>
            <input
              id="sm-q" list="sm-names" placeholder="Find a player…" autoComplete="off" value={query}
              onChange={e => {
                setQuery(e.target.value)
                setSearchMiss(false)
                // Picking from the datalist fills the exact name: jump straight to it.
                if (byNameExact(data.rows, e.target.value)) trySearch(e.target.value)
              }}
              onKeyDown={e => { if (e.key === 'Enter') trySearch(query) }}
            />
            {searchMiss && <div className="sm-miss" role="status">No player found</div>}
            <datalist id="sm-names">
              {data.rows.map(d => <option key={d.key} value={d.name} />)}
            </datalist>
          </div>
          <label className="sm-mingp">
            <span>Min games</span>
            <input
              type="number" min={1} max={82} inputMode="numeric" value={minGp}
              onChange={e => {
                const v = Math.round(Number(e.target.value))
                if (Number.isFinite(v)) setMinGp(Math.min(82, Math.max(1, v)))
              }}
            />
          </label>
          <div className="sm-period">
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
          <div className="sm-status"><LoadingSpinner /></div>
        ) : data.rows.length === 0 ? (
          <div className="sm-status">No players with at least {minGp} games in this period yet.</div>
        ) : (
          <div className="sm-main" style={{ opacity: isFetching ? 0.6 : 1 }}>
            <ShootingMapChart ref={chartRef} input={chartInput} viewKey={viewKey} onToggle={toggle} />
            <aside className="sm-aside">
              <div className="sm-card">
                <h2>Pinned players</h2>
                {selectedRows.length > 0 ? (
                  <ul className="sm-plist">
                    {selectedRows.map(d => <PlayerItem key={d.key} d={d} unit={unit} mode={mode} onFocus={focus} onRemove={remove} />)}
                  </ul>
                ) : (
                  <p className="sm-empty">Click a dot or search for a player to pin them. Pinned players stay labeled on the map.</p>
                )}
              </div>
              <div className="sm-card">
                <h2>Best for {L.pct}{scopeLabel ? ` · ${scopeLabel}` : ''}</h2>
                <ul className="sm-plist">
                  {top.map(d => <PlayerItem key={d.key} d={d} unit={unit} mode={mode} onFocus={focus} />)}
                </ul>
              </div>
              <div className="sm-card">
                <h2>Worst for {L.pct}{scopeLabel ? ` · ${scopeLabel}` : ''}</h2>
                {bottom.length > 0 ? (
                  <ul className="sm-plist">
                    {bottom.map(d => <PlayerItem key={d.key} d={d} unit={unit} mode={mode} onFocus={focus} />)}
                  </ul>
                ) : (
                  <p className="sm-empty">No other players to show.</p>
                )}
              </div>
            </aside>
          </div>
        )}

        <footer className="sm-footer">
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
        </footer>
      </div>
    </div>
  )
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
