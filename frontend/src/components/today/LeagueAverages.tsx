import type { AverageStats, LeagueSummary } from '../../types/api'
import { changedTile, leagueAveragesSubtitle } from '../../utils/liveTonight'

const AVERAGE_TILES: { label: string; value: (a: AverageStats) => string }[] = [
  { label: 'FG%', value: a => a.fg_percentage.toFixed(3) },
  { label: 'FT%', value: a => a.ft_percentage.toFixed(3) },
  { label: '3PM', value: a => a.three_pm.toFixed(2) },
  { label: 'REB', value: a => a.reb.toFixed(2) },
  { label: 'AST', value: a => a.ast.toFixed(2) },
  { label: 'STL', value: a => a.stl.toFixed(2) },
  { label: 'BLK', value: a => a.blk.toFixed(2) },
  { label: 'PTS', value: a => a.pts.toFixed(2) },
  { label: 'GP', value: a => a.gp.toFixed(2) },
]

/** `moved`: tonight changed this value (green tile, as on the design canvas; the heatmap has no such marks). */
function StatTile({ label, value, moved = false }: { label: string; value: string; moved?: boolean }) {
  return (
    <div
      data-moved={moved || undefined}
      className={`rounded-lg px-2 py-1.5 ${moved ? 'bg-emerald-50 outline outline-1 outline-emerald-200 dark:bg-emerald-900/30 dark:outline-emerald-800' : 'bg-gray-50 dark:bg-gray-700'}`}
    >
      <p className="text-[9.5px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">{label}</p>
      <p className="text-sm font-bold tabular-nums text-gray-900 sm:text-base dark:text-gray-50">{value}</p>
    </div>
  )
}

interface LeagueAveragesProps {
  summary: LeagueSummary
}

export default function LeagueAverages({ summary }: LeagueAveragesProps) {
  return (
    <div className="rounded-lg bg-white p-4 shadow dark:bg-gray-800">
      <div className="flex items-baseline justify-between gap-2 pb-2">
        <h2 className="text-base font-bold text-gray-900 sm:text-lg dark:text-gray-50">League averages</h2>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{leagueAveragesSubtitle(summary.live)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {AVERAGE_TILES.map(tile => (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value(summary.league_averages)}
            moved={changedTile(summary.live, tile.value(summary.league_averages), summary.league_averages_official && tile.value(summary.league_averages_official))}
          />
        ))}
        <StatTile label="NBA pace" value={summary.nba_avg_pace == null ? '—' : summary.nba_avg_pace.toFixed(1)} />
        <StatTile label="Days left" value={String(summary.nba_game_days_left ?? 0)} />
        <StatTile label="Teams" value={String(summary.total_teams)} />
      </div>
    </div>
  )
}
