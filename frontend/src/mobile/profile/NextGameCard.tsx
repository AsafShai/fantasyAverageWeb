import { usePersistedState } from '../../hooks/usePersistedState'
import type { ProjectionStats } from '../../types/api'
import { coherentInts } from '../../utils/coherentRound'
import { fmtStat, formatGameDate, pctCell, relativeDay } from '../../utils/nextGameFormat'
import { useSheetProjection } from '../player/useSheetProjection'
import { Card, MinutesStepper } from '../ui'

/**
 * Next-game projection on a phone: the desktop card's line (status dot,
 * matchup and date, Integer projections) with the minutes stepper instead of
 * the slider. Same rules for when there is no block at all, and the same
 * re-predict call when minutes change (shared with the player sheet).
 */
export default function NextGameCard({ playerId, playerName }: { playerId: string; playerName: string }) {
  const { loading, projection } = useSheetProjection(playerId)
  // same remembered setting as the desktop card
  const [integerMode, setIntegerMode] = usePersistedState('playerProjection.integerMode', true)

  if (loading) {
    return (
      <Card aria-label="Next game projection">
        <div className="mr-pp-skel" aria-hidden="true" />
      </Card>
    )
  }
  if (!projection) return null

  const { data, minutes, defaultMinutes, stats: shown, setMinutes } = projection
  const coherent = integerMode ? coherentInts(shown) : null
  const fg = pctCell(shown.fg_pct, coherent ? coherent.fgm : shown.fgm, coherent ? coherent.fga : shown.fga, integerMode)
  const ft = pctCell(shown.ft_pct, coherent ? coherent.ftm : shown.ftm, coherent ? coherent.fta : shown.fta, integerMode)
  const val = (key: keyof ProjectionStats) =>
    coherent && (key === 'pts' || key === 'three_pm') ? String(coherent[key]) : fmtStat(shown[key] as number, integerMode)

  const rel = data.game_date ? relativeDay(data.game_date) : null
  const dateLabel = data.game_date ? ` · ${formatGameDate(data.game_date)}${rel ? ` (${rel})` : ''}` : ''
  const vs = `${data.is_home ? 'vs' : '@'} ${data.opponent}`
  const when = data.scheduled
    ? `Next game: ${vs}${dateLabel}`
    : `Next game unavailable — showing ${vs}${dateLabel} (last played, debug)`
  const dot = data.status === 'green' ? 'mr-pp-dot-g' : data.status === 'amber' ? 'mr-pp-dot-a' : 'mr-pp-dot-r'

  const cols: { k: string; v: string; sub?: string; strong?: boolean }[] = [
    { k: 'MIN', v: String(Math.round(minutes)) },
    { k: 'FG%', v: fg.pct, sub: fg.frac },
    { k: 'FT%', v: ft.pct, sub: ft.frac },
    { k: '3PM', v: val('three_pm') },
    { k: 'REB', v: val('reb') },
    { k: 'AST', v: val('ast') },
    { k: 'STL', v: val('stl') },
    { k: 'BLK', v: val('blk') },
    { k: 'PTS', v: val('pts'), strong: true },
  ]

  return (
    <Card aria-label="Next game projection">
      <div className="mr-pp-row">
        <span className="mr-pp-proj-badge">Projected</span>
        <span className={`mr-pp-dot ${dot}`} title={data.reason || undefined} aria-label={data.reason || `Status ${data.status}`} role="img" />
        <span className="mr-meta mr-pp-grow" title={data.status === 'amber' ? data.reason : undefined}>
          {when}
        </span>
      </div>
      <div className="mr-pp-row">
        <MinutesStepper value={Math.round(minutes)} defaultValue={defaultMinutes} onChange={setMinutes} playerName={playerName} />
        <label className="mr-pp-check">
          <input type="checkbox" checked={integerMode} onChange={(e) => setIntegerMode(e.target.checked)} />
          Integer projections
        </label>
      </div>
      <div className="mr-tw">
        <table className="mr-t mr-pp-proj-t">
          <caption className="sr-only">Projected line {vs}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.k} scope="col" className="mr-c">
                  <span className="mr-th-label">{c.k}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {cols.map((c) => (
                <td key={c.k} className={`mr-c ${c.strong ? 'mr-pp-strong' : ''}`}>
                  {c.v}
                  {c.sub && <span className="mr-pp-sub">{c.sub}</span>}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}
