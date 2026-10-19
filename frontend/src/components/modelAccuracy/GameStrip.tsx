import type { ProjectedGame } from '../../types/api'
import { formatShortDate, formatSigned } from '../../utils/modelAccuracy'

const BAR_W = 12
const GAP = 6
const H = 40
const MAX_Z = 3

/** One bar per game: up = beat the projection, down = trailed it, height =
 *  composite miss (capped at ±3 spread units). Hover shows the game. */
const GameStrip = ({ games }: { games: ProjectedGame[] }) => {
  const width = games.length * BAR_W + Math.max(0, games.length - 1) * GAP
  const mid = H / 2
  return (
    <svg
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      role="img"
      aria-label={`Last ${games.length} games vs projection`}
      className="block"
    >
      <line x1={0} x2={width} y1={mid} y2={mid} stroke="var(--accuracy-zero)" />
      {games.map((g, i) => {
        const h = Math.max(1.5, (Math.min(Math.abs(g.z), MAX_Z) / MAX_Z) * (mid - 2))
        const up = g.z > 0
        return (
          <g key={g.game_date}>
            <title>
              {`${formatShortDate(g.game_date)} vs ${g.opponent}: ${formatSigned(g.z)}σ · PTS ${g.proj_pts.toFixed(1)} → ${Math.round(g.actual_pts)} · MIN ${Math.round(g.proj_min)} → ${Math.round(g.actual_min)}`}
            </title>
            <rect
              x={i * (BAR_W + GAP)}
              y={up ? mid - h : mid}
              width={BAR_W}
              height={h}
              rx={2}
              fill={up ? 'var(--accuracy-pos)' : 'var(--accuracy-neg)'}
            />
            <rect x={i * (BAR_W + GAP) - GAP / 2} y={0} width={BAR_W + GAP} height={H} fill="transparent" />
          </g>
        )
      })}
    </svg>
  )
}

export default GameStrip
