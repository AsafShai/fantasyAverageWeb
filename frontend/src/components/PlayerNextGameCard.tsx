import { useEffect, useRef, useState } from 'react'
import { useGetPlayerNextGameProjectionQuery, usePredictProjectionMutation } from '../store/api/fantasyApi'
import { usePersistedState } from '../hooks/usePersistedState'
import { FF_PAST_SLATES, FF_PROJECTIONS } from '../config/featureFlags'
import type { ProjectionStats, ProjectionStatus } from '../types/api'
import { coherentInts } from '../utils/coherentRound'

// Same colors/sizing as the Projections page's confidence dot, so a player's
// status reads the same whether it's seen there or on their own profile.
function StatusDot({ status, reason }: { status: ProjectionStatus; reason?: string }) {
  const color = status === 'green' ? 'bg-green-500' : status === 'amber' ? 'bg-amber-500' : 'bg-red-500'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} title={reason || undefined} />
}

function fmtStat(n: number, integer: boolean): string {
  return integer ? String(Math.round(n)) : n.toFixed(1)
}

function pctCell(pctVal: number, made: number, att: number, integer: boolean): { pct: string; frac: string } {
  if (!(att > 0)) return { pct: '—', frac: '' }
  if (integer) {
    const m = Math.round(made), a = Math.round(att)
    return { pct: a > 0 ? `${Math.round((m / a) * 100)}%` : '—', frac: `${m}/${a}` }
  }
  return { pct: `${(pctVal * 100).toFixed(1)}%`, frac: `${made.toFixed(1)}/${att.toFixed(1)}` }
}

function formatGameDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

function relativeDay(iso: string): string | null {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86400000)
  if (days < 0) return null
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  return `in ${days} days`
}

function Skeleton() {
  return (
    <div className="mt-4 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 px-3 py-2.5 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded ml-2" />
      </div>
      <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  )
}

const PlayerNextGameCard = ({ playerId }: { playerId: string }) => {
  const { data, isLoading, isError } = useGetPlayerNextGameProjectionQuery(playerId, { skip: !playerId || !FF_PROJECTIONS })
  const [predict] = usePredictProjectionMutation()
  const [integerMode, setIntegerMode] = usePersistedState('playerProjection.integerMode', true)
  const [minutes, setMinutes] = useState(0)
  const [stats, setStats] = useState<ProjectionStats | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keyed on stable primitives, not the response object — a background
  // revalidation must not wipe an adjusted slider.
  const defaultMinutes = data?.default_minutes ?? 0
  const opponent = data?.opponent ?? null
  useEffect(() => {
    clearTimeout(timer.current)
    setMinutes(defaultMinutes)
    setStats(data?.stats ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opponent, defaultMinutes])

  if (!FF_PROJECTIONS) return null

  // No line to show = no block at all. Covers every "can't project" case the
  // backend can return: unknown player, insufficient history (<10 games,
  // status 'red'), and no game found at all (brand-new team with no past
  // games either). The unscheduled-fallback line (offseason: shows the
  // team's last played game instead of a real "next" one) is a debug view,
  // gated behind the same flag as the Projections page's past-slates picker.
  if (isLoading) return <Skeleton />
  const hasLine = !!data?.opponent && data.status !== 'red' && !!data.stats
  if (isError || !data || !hasLine) return null
  if (!data.scheduled && !FF_PAST_SLATES) return null

  const onSlider = (v: number) => {
    setMinutes(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await predict({
          player_name: data.player_name, opponent: data.opponent as string,
          is_home: data.is_home, minutes: v,
        }).unwrap()
        setStats(res.stats)
      } catch { /* ignore transient predict errors */ }
    }, 350)
  }

  const resetToDefault = () => {
    clearTimeout(timer.current)
    setMinutes(data.default_minutes)
    setStats(data.stats)
  }

  const isAdjusted = Math.round(minutes) !== Math.round(data.default_minutes)
  const shown = stats ?? data.stats!
  const coherent = integerMode ? coherentInts(shown) : null
  const fg = pctCell(shown.fg_pct, coherent ? coherent.fgm : shown.fgm, coherent ? coherent.fga : shown.fga, integerMode)
  const ft = pctCell(shown.ft_pct, coherent ? coherent.ftm : shown.ftm, coherent ? coherent.fta : shown.fta, integerMode)
  const val = (key: keyof ProjectionStats) =>
    coherent && (key === 'pts' || key === 'three_pm')
      ? String(coherent[key])
      : fmtStat(shown[key] as number, integerMode)
  const fgm = coherent ? String(coherent.fgm) : shown.fgm.toFixed(1)
  const fga = coherent ? String(coherent.fga) : shown.fga.toFixed(1)
  const ftm = coherent ? String(coherent.ftm) : shown.ftm.toFixed(1)
  const fta = coherent ? String(coherent.fta) : shown.fta.toFixed(1)

  const rel = data.game_date ? relativeDay(data.game_date) : null
  const dateLabel = data.game_date ? ` · ${formatGameDate(data.game_date)}${rel ? ` (${rel})` : ''}` : ''
  const when = data.scheduled
    ? `Next game: ${data.is_home ? 'vs' : '@'} ${data.opponent}${dateLabel}`
    : `Next game unavailable — showing ${data.is_home ? 'vs' : '@'} ${data.opponent}${dateLabel} (last played, debug)`

  return (
    <div className="mt-4 bg-white dark:bg-gray-900 rounded-lg shadow border border-gray-200 dark:border-gray-700 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 mb-3">
        <span className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 border border-blue-300 dark:border-blue-800 rounded px-1.5 py-0.5">
          Projected
        </span>
        <StatusDot status={data.status} reason={data.reason} />
        <span className="text-xs text-gray-600 dark:text-gray-300" title={data.status === 'amber' ? data.reason : undefined}>
          {when}
        </span>

        <span className="flex items-center gap-1.5 ml-2">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">MIN</span>
          <input
            type="range" min={0} max={48} step={1} value={Math.round(minutes)}
            onChange={(e) => onSlider(Number(e.target.value))}
            className="w-24 sm:w-36 h-1 accent-blue-600"
            aria-label="Projected minutes"
          />
          <span className="tabular-nums w-6 text-right text-xs font-semibold text-gray-900 dark:text-gray-100">{Math.round(minutes)}</span>
          <button
            type="button"
            onClick={resetToDefault}
            title={`Reset to default (${Math.round(data.default_minutes)} min)`}
            className={`text-[11px] leading-none px-1.5 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 ${isAdjusted ? '' : 'invisible'}`}
          >
            ↺
          </button>
        </span>

        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input type="checkbox" checked={integerMode} onChange={(e) => setIntegerMode(e.target.checked)} className="accent-blue-600" />
          Integer projections
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400">
              <th className="hidden sm:table-cell text-left font-medium pr-2 pb-1.5"></th>
              <th className="px-1 pb-1.5 font-medium">MIN</th>
              <th className="px-1 pb-1.5 font-medium">PTS</th>
              <th className="px-1 pb-1.5 font-medium">REB</th>
              <th className="px-1 pb-1.5 font-medium">AST</th>
              <th className="px-1 pb-1.5 font-medium">STL</th>
              <th className="px-1 pb-1.5 font-medium">BLK</th>
              <th className="px-1 pb-1.5 font-medium">3PM</th>
              <th className="hidden sm:table-cell px-1 pb-1.5 font-medium">FGM</th>
              <th className="hidden sm:table-cell px-1 pb-1.5 font-medium">FGA</th>
              <th className="px-1 pb-1.5 font-medium">FG%</th>
              <th className="hidden sm:table-cell px-1 pb-1.5 font-medium">FTM</th>
              <th className="hidden sm:table-cell px-1 pb-1.5 font-medium">FTA</th>
              <th className="px-1 pb-1.5 font-medium">FT%</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-blue-50/70 dark:bg-blue-900/20 rounded">
              <td className="hidden sm:table-cell text-left font-semibold text-gray-700 dark:text-gray-200 pr-2 py-2 whitespace-nowrap">
                Projected {data.is_home ? 'vs' : '@'} {data.opponent}
              </td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{Math.round(minutes)}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{val('pts')}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{val('reb')}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{val('ast')}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{val('stl')}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{val('blk')}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">{val('three_pm')}</td>
              <td className="hidden sm:table-cell px-1 py-2 text-center tabular-nums font-semibold">{fgm}</td>
              <td className="hidden sm:table-cell px-1 py-2 text-center tabular-nums font-semibold">{fga}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">
                {fg.pct}
                {fg.frac && <span className="sm:hidden block text-[9px] font-normal text-gray-400">{fg.frac}</span>}
              </td>
              <td className="hidden sm:table-cell px-1 py-2 text-center tabular-nums font-semibold">{ftm}</td>
              <td className="hidden sm:table-cell px-1 py-2 text-center tabular-nums font-semibold">{fta}</td>
              <td className="px-1 py-2 text-center tabular-nums font-semibold">
                {ft.pct}
                {ft.frac && <span className="sm:hidden block text-[9px] font-normal text-gray-400">{ft.frac}</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PlayerNextGameCard
