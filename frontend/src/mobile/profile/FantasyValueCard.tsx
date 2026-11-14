import { useSectionOpen } from '../../hooks/useSectionOpen'
import { Link } from 'react-router'
import InfoTip from '../../components/InfoTip'
import { CATEGORY_LABELS, type PlayerRankSummary, type RankingCategory } from '../../utils/playerRankings'
import { Card } from '../ui'

// Bars saturate at ±Z_CAP so one outlier category doesn't flatten the rest (same as desktop).
const Z_CAP = 2.5

function tone(z: number, neutralBand = 0.5): string {
  if (z >= neutralBand) return 'mr-pp-pos'
  if (z <= -neutralBand) return 'mr-pp-neg'
  return ''
}

function signed(z: number): string {
  return `${z >= 0 ? '+' : ''}${z.toFixed(2)}`
}

interface Props {
  positions: string[]
  summary: PlayerRankSummary | null
  categories: RankingCategory[]
  loading: boolean
  periodLabel: string
}

/**
 * Fantasy Value on a phone: overall + position ranks, Z-score, ESPN
 * eligibility and the green/red category z-bars, with Full rankings.
 */
export default function FantasyValueCard({ positions, summary, categories, loading, periodLabel }: Props) {
  const [open, toggle] = useSectionOpen('fantasy-value')
  const head = (
    <Link to="/player-rankings" className="mr-link">
      Full rankings →
    </Link>
  )
  if (loading) {
    return (
      <Card title={`Fantasy Value · ${periodLabel}`} action={head} fold={{ open, onToggle: toggle }}>
        <div className="mr-pp-skel" data-testid="fantasy-value-skeleton" aria-hidden="true" />
      </Card>
    )
  }

  const realPositions = positions.filter((p) => p && p !== 'Unknown')

  return (
    <Card title={`Fantasy Value · ${periodLabel}`} action={head} aria-label="Fantasy Value" fold={{ open, onToggle: toggle }}>
      <div className="mr-pp-tiles mr-c2">
        <div className="mr-pp-tile">
          <span className="mr-pp-tl">Overall rank</span>
          {summary ? (
            summary.rank != null ? (
              <span className="mr-pp-tv" data-testid="fantasy-rank">
                #{summary.rank} <span className="mr-meta">of {summary.poolSize}</span>
              </span>
            ) : (
              <span className="mr-pp-tv mr-pp-sm" data-testid="fantasy-rank">
                Outside top {summary.poolSize}
              </span>
            )
          ) : (
            <span className="mr-pp-tv mr-pp-faint">—</span>
          )}
          {summary && summary.positionRanks.length > 0 && (
            <span className="mr-meta">
              {summary.positionRanks.map(({ position, rank }) => `#${rank} ${position}`).join(' · ')}
            </span>
          )}
        </div>
        <div className="mr-pp-tile">
          <span className="mr-pp-tl mr-pp-tl-row">
            Z-score
            <InfoTip
              title="Z-score"
              body="Average of this player's per-category z-scores vs. the ranked pool. 0 is average; higher is better."
              formula={`${periodLabel} · per game · equal weights`}
            />
          </span>
          {summary ? (
            <span className={`mr-pp-tv ${tone(summary.totalZ, 0.25)}`} data-testid="fantasy-z">
              {signed(summary.totalZ)}
            </span>
          ) : (
            <span className="mr-pp-tv mr-pp-faint">—</span>
          )}
        </div>
      </div>

      <div className="mr-pp-row">
        <span className="mr-meta">ESPN eligibility</span>
        {realPositions.length > 0 ? (
          <span className="mr-pp-elig" aria-label="ESPN position eligibility">
            {realPositions.map((pos) => (
              <span key={pos} className="mr-pp-pos-badge">
                {pos}
              </span>
            ))}
          </span>
        ) : (
          <span className="mr-meta">—</span>
        )}
      </div>

      {summary ? (
        <>
          <div className="mr-card-head">
            <h3 className="mr-pp-h3">Category z-scores</h3>
            <span className="mr-meta">{periodLabel} · per game</span>
          </div>
          <div className="mr-pp-zbars">
            {categories.map((cat) => {
              const label = CATEGORY_LABELS[cat] ?? cat
              const z = summary.zScores[cat] ?? 0
              const width = (Math.min(Math.abs(z), Z_CAP) / Z_CAP) * 50
              const pos = z >= 0
              return (
                <div key={cat} className="mr-pp-zb" aria-label={`${label} z-score ${signed(z)}`}>
                  <span className="mr-pp-zk">{label}</span>
                  <span className="mr-pp-zt" aria-hidden="true">
                    <span className="mr-pp-zm" />
                    <span
                      className={`mr-pp-zf ${pos ? 'mr-pp-zf-pos' : 'mr-pp-zf-neg'}`}
                      style={pos ? { left: '50%', width: `${width}%` } : { right: '50%', width: `${width}%` }}
                    />
                  </span>
                  <span className={`mr-pp-zv ${tone(z)}`}>{signed(z)}</span>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <p className="mr-meta">No stats in this time frame, so there's no rank or z-score for this player.</p>
      )}
    </Card>
  )
}
