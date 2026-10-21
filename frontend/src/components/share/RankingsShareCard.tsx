import type { RankingStats } from '../../types/api'
import { ShareCard, type ShareCardTheme } from './ShareCard'
import { formatCardValue, formatPoints, rotoTone } from './shareCardFormat'

interface RankingsShareCardProps extends ShareCardTheme {
  /** Rows in the order the page currently shows them. */
  rows: RankingStats[]
  categories: string[]
  view: 'standings' | 'rankings'
  mode: 'averages' | 'totals'
  /** e.g. "Oct 1 – Oct 15"; omitted for the full season. */
  rangeLabel?: string
  asOf: string
  highlightTeamId: number | null
}

/** Roto table mirroring the Rankings page: per-category roto points in the
 * Rankings view, compact values in the Standings view, tinted by those points. */
export const RankingsShareCard = ({ rows, categories, view, mode, rangeLabel, asOf, highlightTeamId, dark }: RankingsShareCardProps) => {
  const isStandings = view === 'standings'
  const teamCount = rows.length
  const modeLabel = mode === 'averages' ? 'averages' : 'totals'
  const period = rangeLabel ?? 'Season'

  return (
    <ShareCard
      dark={dark}
      wide
      kicker={`${categories.length}-cat roto`}
      title={isStandings ? 'Roto Standings' : 'Roto Rankings'}
      subtitle={`${period} ${modeLabel} · as of ${asOf}`}
      footer={<><span>Green = top 3 · Red = bottom 3</span><span>{teamCount} teams</span></>}
    >
      <div className="share-card__body">
        <table>
          <colgroup>
            <col style={{ width: 20 }} />
            <col style={{ width: isStandings ? 118 : 128 }} />
            {categories.map(c => <col key={c} />)}
            <col style={{ width: 38 }} />
            <col style={{ width: 36 }} />
          </colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th className="sc-left">Team</th>
              {categories.map(c => <th key={c}>{c}</th>)}
              <th>Tot</th>
              <th className="sc-gp">GP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.team.team_id} className={row.team.team_id === highlightTeamId ? 'sc-me' : undefined}>
                <td className="sc-rank">{row.rank || index + 1}</td>
                <td className="sc-left sc-wrap">{row.team.team_name}</td>
                {categories.map(c => {
                  const points = row.category_ranks?.[c]
                  const value = row.stats?.[c]
                  const tone = rotoTone(points, teamCount)
                  const text = isStandings
                    ? (value === undefined ? '–' : formatCardValue(c, value, mode))
                    : (points ?? '–')
                  return (
                    <td key={c}>
                      <span className={`sc-chip${tone ? ` sc-${tone}` : ''}`}>{text}</span>
                    </td>
                  )
                })}
                <td className="sc-strong">{formatPoints(row.total_points)}</td>
                <td className="sc-gp">{row.gp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ShareCard>
  )
}
