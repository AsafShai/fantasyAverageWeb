import type { TeamRanking } from '../../types/estimator'
import { formatRankProbabilityPercent, getProbColor, type HeatmapRow } from '../../utils/rankProbability'
import { ShareCard, type ShareCardTheme } from './ShareCard'

interface RankProbabilityShareCardProps extends ShareCardTheme {
  /** Rows in the order the page shows them (most likely place first). */
  rows: HeatmapRow[]
  places: number[]
  asOf: string
  highlightTeamId: number | null
}

/** The Estimator's rank probability heatmap: percent chance of each finishing place. */
export const RankProbabilityShareCard = ({ rows, places, asOf, highlightTeamId, dark }: RankProbabilityShareCardProps) => (
  <ShareCard
    dark={dark}
    wide
    extraWide
    kicker="Season estimator"
    title="Rank Probability"
    subtitle={`Chance of each finishing place · as of ${asOf}`}
    footer={<><span>Teams ordered by most likely place</span><span>{rows.length} teams</span></>}
  >
    <div className="share-card__body">
      <table>
        <colgroup>
          <col style={{ width: 150 }} />
          {places.map(p => <col key={p} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="sc-left">Team</th>
            {places.map(p => <th key={p}>{p}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.team_id} className={row.team_id === highlightTeamId ? 'sc-me' : undefined}>
              <td className="sc-left sc-wrap">{row.team_name}</td>
              {places.map(p => {
                const prob = row.probs.get(p) ?? 0
                const { bg, text } = getProbColor(prob, dark)
                return (
                  <td key={p} className="sc-heat" style={{ backgroundColor: bg, color: text }}>
                    {formatRankProbabilityPercent(prob)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </ShareCard>
)

const STAT_KEYS = ['fg_pct', 'ft_pct', 'three_pm', 'reb', 'ast', 'stl', 'blk', 'pts'] as const
const STAT_LABELS: Record<typeof STAT_KEYS[number], string> = {
  fg_pct: 'FG%', ft_pct: 'FT%', three_pm: '3PM', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', pts: 'PTS',
}

interface ProjectedRankingsShareCardProps extends ShareCardTheme {
  /** Rows in the order the page currently shows them. */
  rows: TeamRanking[]
  asOf: string
  highlightTeamId: number | null
}

/** The Estimator's projected end-of-season roto points per category, plus projected games. */
export const ProjectedRankingsShareCard = ({ rows, asOf, highlightTeamId, dark }: ProjectedRankingsShareCardProps) => (
  <ShareCard
    dark={dark}
    wide
    kicker="Season estimator"
    title="Projected Rankings"
    subtitle={`Projected end-of-season roto points · as of ${asOf}`}
    footer={<><span>GP = projected games played</span><span>{rows.length} teams</span></>}
  >
    <div className="share-card__body">
      <table>
        <colgroup>
          <col style={{ width: 24 }} />
          <col style={{ width: 118 }} />
          {STAT_KEYS.map(k => <col key={k} />)}
          <col style={{ width: 38 }} />
          <col style={{ width: 36 }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th className="sc-left">Team</th>
            {STAT_KEYS.map(k => <th key={k}>{STAT_LABELS[k]}</th>)}
            <th>Tot</th>
            <th className="sc-gp">GP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.team_id} className={row.team_id === highlightTeamId ? 'sc-me' : undefined}>
              <td className="sc-rank">{row.rank}</td>
              <td className="sc-left sc-wrap">{row.team_name}</td>
              {STAT_KEYS.map(k => <td key={k}>{row[`expected_pts_${k}`].toFixed(1)}</td>)}
              <td className="sc-strong">{row.total_expected_pts.toFixed(1)}</td>
              <td className="sc-gp">{row.projected_total_gp.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </ShareCard>
)
