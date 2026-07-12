import React, { useState, useMemo, useRef } from 'react'
import { useGetDraftReportQuery, useGetAllPlayersQuery } from '../store/api/fantasyApi'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import { FF_DRAFT_STEALS_BUSTS } from '../config/featureFlags'
import { buildScoredPicks, buildTeamDiffRanking, topSteals, topBusts, MIN_GP_FOR_RANK, LOW_GP_MIN, type ScoredPick, type DraftBadge } from '../utils/draftReport'

type SortCol = 'pick' | 'diff' | 'valueRank'

const BADGE_STYLES: Record<DraftBadge, string> = {
  Steal: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Solid: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  Fair: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  Reach: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  Bust: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  INJ: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  DNP: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
}

// const GRADE_STYLES: Record<string, string> = {
//   A: 'bg-green-600', B: 'bg-teal-600', C: 'bg-amber-600', D: 'bg-orange-600', F: 'bg-red-600',
// }

function valueTag(p: ScoredPick): string {
  if (p.valueRank !== null) return `#${p.valueRank}`
  if (p.badge === 'DNP') return 'DNP'
  return `INJ ${p.gp}gp`
}

function heatColor(p: ScoredPick): string {
  if (p.badge === 'INJ' || p.badge === 'DNP') return 'rgba(220,38,38,0.35)'
  const d = Math.max(-60, Math.min(60, p.diff ?? 0))
  if (d > 8) return `rgba(37,99,235,${(0.08 + (d / 60) * 0.38).toFixed(2)})`
  if (d < -8) return `rgba(220,38,38,${(0.08 - (d / 60) * 0.38).toFixed(2)})`
  return 'rgba(156,163,175,0.10)'
}

export default function DraftReport() {
  const [calcMode, setCalcMode] = useState<'totals' | 'per_game'>('per_game')
  const [includeLowGp, setIncludeLowGp] = useState(false)
  const minGp = includeLowGp ? LOW_GP_MIN : MIN_GP_FOR_RANK
  const { data: draftReport, isLoading: draftLoading, error: draftError } = useGetDraftReportQuery()
  // Same pool Player Rankings uses (season, full ESPN universe) — keeps the
  // draft report's value calc consistent with the rest of the app instead of
  // maintaining a separate data source.
  const { data: playersData, isLoading: poolLoading, error: poolError } = useGetAllPlayersQuery({ limit: 1200, time_period: 'season' })
  const [sortCol, setSortCol] = useState<SortCol>('pick')
  const [sortAsc, setSortAsc] = useState(true)

  const scoredPicks = useMemo(() => {
    if (!draftReport || !playersData) return []
    return buildScoredPicks(draftReport.picks, playersData.players, calcMode, minGp)
  }, [draftReport, playersData, calcMode, minGp])

  // const teamGrades = useMemo(() => buildTeamGrades(scoredPicks), [scoredPicks])
  const teamDiffs = useMemo(() => buildTeamDiffRanking(scoredPicks), [scoredPicks])
  const [diffColWidths, setDiffColWidths] = useState<number[]>([48, 190, 110, 100, 90])
  const [expandedTeams, setExpandedTeams] = useState<Set<number>>(new Set())
  const toggleTeam = (id: number) => setExpandedTeams(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const diffDragRef = useRef<{ i: number; startX: number; startW: number } | null>(null)
  const onDiffResizeDown = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    diffDragRef.current = { i, startX: e.clientX, startW: diffColWidths[i] }
    const move = (ev: MouseEvent) => {
      const d = diffDragRef.current
      if (!d) return
      const w = Math.max(40, d.startW + (ev.clientX - d.startX))
      setDiffColWidths(prev => prev.map((x, idx) => (idx === d.i ? w : x)))
    }
    const up = () => {
      diffDragRef.current = null
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
  const steals = useMemo(() => topSteals(scoredPicks), [scoredPicks])
  const busts = useMemo(() => topBusts(scoredPicks), [scoredPicks])

  const teamColumns = useMemo(() => {
    return [...scoredPicks]
      .filter(p => p.round === 1)
      .sort((a, b) => a.pick - b.pick)
      .map(p => ({ team_id: p.team_id, team_name: p.team_name }))
  }, [scoredPicks])

  const rounds = useMemo(() => [...new Set(scoredPicks.map(p => p.round))].sort((a, b) => a - b), [scoredPicks])

  const gridByRoundTeam = useMemo(() => {
    const map = new Map<string, ScoredPick>()
    for (const p of scoredPicks) map.set(`${p.round}-${p.team_id}`, p)
    return map
  }, [scoredPicks])

  const [teamFilter, setTeamFilter] = useState<number | null>(null)

  const sortedPicks = useMemo(() => {
    const withFallback = (p: ScoredPick, col: SortCol) => {
      if (col === 'pick') return p.pick
      if (col === 'diff') return p.diff ?? -9999
      return p.valueRank ?? 9999
    }
    const filtered = teamFilter === null ? scoredPicks : scoredPicks.filter(p => p.team_id === teamFilter)
    return [...filtered].sort((a, b) => {
      const av = withFallback(a, sortCol)
      const bv = withFallback(b, sortCol)
      return sortAsc ? av - bv : bv - av
    })
  }, [scoredPicks, sortCol, sortAsc, teamFilter])

  const handleSort = (col: SortCol) => {
    if (col === sortCol) setSortAsc(a => !a)
    else { setSortCol(col); setSortAsc(true) }
  }

  if (draftLoading || poolLoading) return <LoadingSpinner />
  if (draftError || poolError) return <ErrorMessage message="Failed to load draft report." />

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-screen-2xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📝 Draft Report Card</h1>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeLowGp}
                onChange={e => setIncludeLowGp(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              Include low-GP players (&lt;{MIN_GP_FOR_RANK} GP)
            </label>
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
              {(['totals', 'per_game'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setCalcMode(m)}
                  className={`px-3 py-1.5 ${calcMode === m ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                >
                  {m === 'totals' ? 'Totals' : 'Per Game'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500 -mt-4">
          Every pick vs realized season value (8-cat z-score rank). Diff = pick number − value rank: positive means the player returned more than draft slot price.
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-4">
          Value calc: season stats · min {minGp} GP to qualify · all 8 categories weighted equally.
        </p>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Draft Board — value heat</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">Rd</th>
                  {teamColumns.map(t => (
                    <th key={t.team_id} className="px-2 py-1.5 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{t.team_name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rounds.map(round => (
                  <tr key={round} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="sticky left-0 z-10 bg-white dark:bg-gray-800 px-2 py-1.5 font-semibold text-gray-500 dark:text-gray-400 border-r border-gray-200 dark:border-gray-700">{round}</td>
                    {teamColumns.map(t => {
                      const p = gridByRoundTeam.get(`${round}-${t.team_id}`)
                      if (!p) return <td key={t.team_id} className="px-2 py-1.5" />
                      return (
                        <td key={t.team_id} className="px-2 py-1.5 align-top min-w-[110px]" style={{ backgroundColor: heatColor(p) }}>
                          <div className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{p.player_name}</div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">{p.pick} → {valueTag(p)}</div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Blue = returned above slot · Red = below slot / INJ / DNP · Gray = about right.</p>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Team Draft Value — diff vs slot</h2>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-x-auto">
            <table className="text-sm" style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}>
              <colgroup>
                {diffColWidths.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
              </colgroup>
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  {(['#', 'Team', 'Ranked / Picks', 'Total Diff', 'Avg Diff'] as const).map((label, i) => (
                    <th
                      key={label}
                      title={label === 'Ranked / Picks' ? `How many of the team's draft picks earned a value rank — only players with ${minGp}+ GP are ranked, so low-GP / DNP picks are left out` : undefined}
                      className={`relative px-2 sm:px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 ${i >= 2 ? 'text-right' : 'text-left'}`}
                    >
                      {label}
                      {i < diffColWidths.length - 1 && (
                        <span
                          onMouseDown={onDiffResizeDown(i)}
                          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-blue-400/60"
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamDiffs.map((t, i) => {
                  const hasExcluded = t.unranked.length > 0
                  const open = expandedTeams.has(t.team_id)
                  return (
                    <React.Fragment key={t.team_id}>
                      <tr
                        onClick={() => hasExcluded && toggleTeam(t.team_id)}
                        className={`border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${hasExcluded ? 'cursor-pointer' : ''}`}
                      >
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-gray-400 dark:text-gray-500 font-mono text-xs">{i + 1}</td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 truncate">{t.team_name}</td>
                        <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-right text-gray-500 dark:text-gray-400 text-xs font-mono whitespace-nowrap">
                          {t.n}/{t.total}
                          <span className="inline-block w-3 text-left text-amber-500 dark:text-amber-400">{hasExcluded ? (open ? '▾' : '▸') : ''}</span>
                        </td>
                        <td className={`px-2 sm:px-3 py-1.5 sm:py-2 text-right font-mono text-xs ${t.totalDiff >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-500 dark:text-red-400'}`}>
                          {t.totalDiff > 0 ? `+${t.totalDiff}` : t.totalDiff}
                        </td>
                        <td className={`px-2 sm:px-3 py-1.5 sm:py-2 text-right font-semibold font-mono ${t.avgDiff >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-500 dark:text-red-400'}`}>
                          {t.avgDiff > 0 ? `+${t.avgDiff.toFixed(1)}` : t.avgDiff.toFixed(1)}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-gray-50 dark:bg-gray-900/40 border-b border-gray-100 dark:border-gray-700">
                          <td />
                          <td colSpan={4} className="px-2 sm:px-3 py-2">
                            <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">Not ranked (under {minGp} GP — excluded from diff):</div>
                            <div className="flex flex-wrap gap-1.5">
                              {t.unranked.map(u => (
                                <span key={u.pick} className="inline-flex items-center gap-1 text-xs bg-white dark:bg-gray-800 rounded px-1.5 py-0.5 border border-gray-200 dark:border-gray-700">
                                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${BADGE_STYLES[u.badge]}`}>{u.badge}</span>
                                  <span className="text-gray-700 dark:text-gray-200">{u.player_name}</span>
                                  <span className="text-gray-400 dark:text-gray-500">#{u.pick} · {u.gp ?? 0}gp</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
                {teamDiffs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-2 text-xs text-gray-400">No qualifying picks yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Sum / avg of (pick − value rank) over ranked picks. Positive = team's picks returned above draft slot. Rows with ▸ expand to show picks left out (under {minGp} GP). Drag column edges to resize.</p>
        </section>

        {FF_DRAFT_STEALS_BUSTS && (
          <>
            {/* <section>
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">Team Grades</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                {teamGrades.map(t => (
                  <div key={t.team_id} className="bg-white dark:bg-gray-800 rounded-lg shadow p-2.5 flex items-center gap-2">
                    <span className={`w-8 h-8 shrink-0 rounded-md flex items-center justify-center text-white font-extrabold ${GRADE_STYLES[t.grade]}`}>
                      {t.grade}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{t.team_name}</div>
                      <div className="text-[11px] text-gray-400 dark:text-gray-500">
                        {(t.ratio * 100).toFixed(0)}% value · {(t.hitRate * 100).toFixed(0)}% hits
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section> */}

            <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">💎 Top Steals (min 50 GP)</h2>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-100 dark:divide-gray-700">
                  {steals.map(p => (
                    <div key={`${p.pick}`} className="p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${BADGE_STYLES[p.badge]}`}>Steal</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{p.player_name}</span>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500">pick {p.pick} → value {valueTag(p)} · {p.team_name}</div>
                      </div>
                    </div>
                  ))}
                  {steals.length === 0 && <div className="p-2.5 text-xs text-gray-400">No qualifying steals yet.</div>}
                </div>
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-2">🕳️ Biggest Busts</h2>
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-100 dark:divide-gray-700">
                  {busts.map(p => (
                    <div key={`${p.pick}`} className="p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 ${BADGE_STYLES[p.badge]}`}>{p.badge}</span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">{p.player_name}</span>
                        <div className="text-[11px] text-gray-400 dark:text-gray-500">pick {p.pick} → value {valueTag(p)} · {p.team_name}</div>
                      </div>
                    </div>
                  ))}
                  {busts.length === 0 && <div className="p-2.5 text-xs text-gray-400">No busts yet.</div>}
                </div>
              </div>
            </section>
          </>
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">All Picks</h2>
            <select
              value={teamFilter ?? ''}
              onChange={e => setTeamFilter(e.target.value === '' ? null : Number(e.target.value))}
              className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              <option value="">All teams</option>
              {teamColumns.map(t => (
                <option key={t.team_id} value={t.team_id}>{t.team_name}</option>
              ))}
            </select>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-auto max-h-[70vh]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-20 bg-gray-50 dark:bg-gray-900">
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                  <SortTh col="pick" label="Pick" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="hidden sm:table-cell px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Rd</th>
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 sticky left-0 z-10 bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">Player</th>
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Team</th>
                  <th className="px-1.5 sm:px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">GP</th>
                  <th className="hidden sm:table-cell px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">MPG</th>
                  <th className="px-1.5 sm:px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">zTotal</th>
                  <SortTh col="valueRank" label="Value" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <SortTh col="diff" label="Diff" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                  <th className="px-1.5 sm:px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {sortedPicks.map(p => (
                  <tr key={p.pick} className="group border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-500 dark:text-gray-400 text-center font-mono text-xs">{p.pick}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-gray-500 dark:text-gray-400 text-xs">{p.round}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap text-xs sm:text-sm sticky left-0 z-10 bg-white dark:bg-gray-800 group-hover:bg-gray-50 dark:group-hover:bg-gray-700/50 border-r border-gray-200 dark:border-gray-700">{p.player_name}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{p.team_name}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-gray-700 dark:text-gray-300 text-xs sm:text-sm">{p.gp ?? '—'}</td>
                    <td className="hidden sm:table-cell px-3 py-2 text-right text-gray-700 dark:text-gray-300">{p.mpg !== null ? p.mpg.toFixed(1) : '—'}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right font-mono text-xs text-gray-700 dark:text-gray-300">{p.totalZ !== null ? p.totalZ.toFixed(2) : '—'}</td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-xs sm:text-sm text-gray-700 dark:text-gray-300">{valueTag(p)}</td>
                    <td className={`px-1.5 sm:px-3 py-1.5 sm:py-2 text-right text-xs sm:text-sm font-semibold ${p.valueRank !== null && p.diff !== null && p.diff >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-500 dark:text-red-400'}`}>
                      {p.valueRank !== null && p.diff !== null ? (p.diff > 0 ? `+${p.diff}` : p.diff) : '—'}
                    </td>
                    <td className="px-1.5 sm:px-3 py-1.5 sm:py-2">
                      <span className={`inline-block text-[10px] font-bold px-1.5 py-0.5 rounded ${BADGE_STYLES[p.badge]}`}>{p.badge}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}

function SortTh({ col, label, sortCol, sortAsc, onSort }: {
  col: SortCol
  label: string
  sortCol: SortCol
  sortAsc: boolean
  onSort: (col: SortCol) => void
}) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      tabIndex={0}
      role="button"
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSort(col)}
      aria-sort={active ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      className={`px-1.5 py-2 sm:px-3 text-right text-xs font-semibold cursor-pointer select-none ${active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
    >
      {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </th>
  )
}
