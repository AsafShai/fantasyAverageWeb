import type { RankingStats, TeamRankChange } from '../../types/api'
import { ShareCard, type ShareCardTheme } from './ShareCard'
import { formatCardValue, formatPoints } from './shareCardFormat'

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
  /** Last night's moves by team id; omitted when the page hides them. */
  moves?: Map<number, TeamRankChange>
}

/** ▲/▼ change since the previous night; nothing for no change unless `showSame`. */
const CardDelta = ({ value, showSame = false }: { value: number | null | undefined; showSame?: boolean }) => {
  if (value == null) return null
  const size = Math.abs(value) % 1 === 0 ? Math.abs(value) : Math.abs(value).toFixed(1)
  if (value > 0) return <span className="sc-delta sc-up">▲{size}</span>
  if (value < 0) return <span className="sc-delta sc-down">▼{size}</span>
  return showSame ? <span className="sc-delta sc-same">–</span> : null
}

/** Roto table mirroring the Rankings page: per-category roto points in the
 * Rankings view, compact values in the Standings view. */
export const RankingsShareCard = ({ rows, categories, view, mode, rangeLabel, asOf, highlightTeamId, moves, dark }: RankingsShareCardProps) => {
  const isStandings = view === 'standings'
  const teamCount = rows.length
  const modeLabel = mode === 'averages' ? 'averages' : 'totals'
  const period = rangeLabel ?? 'Season'

  return (
    <ShareCard
      dark={dark}
      wide
      extraWide={!!moves}
      kicker={`${categories.length}-cat roto`}
      title={isStandings ? 'Roto Standings' : 'Roto Rankings'}
      subtitle={`${period} ${modeLabel} · as of ${asOf}`}
      footer={<><span>{moves ? '▲▼ = change since last night' : ''}</span><span>{teamCount} teams</span></>}
    >
      <div className="share-card__body">
        <table>
          <colgroup>
            <col style={{ width: moves ? 50 : 20 }} />
            <col style={{ width: isStandings ? 118 : 128 }} />
            {categories.map(c => <col key={c} />)}
            <col style={{ width: moves ? 58 : 38 }} />
            <col style={{ width: moves ? 50 : 36 }} />
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
            {rows.map((row, index) => {
              const move = moves?.get(row.team.team_id)
              return (
              <tr key={row.team.team_id} className={row.team.team_id === highlightTeamId ? 'sc-me' : undefined}>
                <td className="sc-rank"><span className="sc-val">{row.rank || index + 1}<CardDelta value={move?.rank_delta} showSame /></span></td>
                <td className="sc-left sc-wrap">{row.team.team_name}</td>
                {categories.map(c => {
                  const points = row.category_ranks?.[c]
                  const value = row.stats?.[c]
                  const text = isStandings
                    ? (value === undefined ? '–' : formatCardValue(c, value, mode))
                    : (points ?? '–')
                  return (
                    <td key={c}>
                      <span className="sc-val">
                        <span className="sc-chip">{text}</span>
                        {move && !isStandings && <CardDelta value={move.categories[c]} />}
                      </span>
                    </td>
                  )
                })}
                <td className="sc-strong"><span className="sc-val">{formatPoints(row.total_points)}<CardDelta value={move?.total_delta} showSame /></span></td>
                <td className="sc-gp"><span className="sc-val">{row.gp}{move?.gp_delta != null && <span className="sc-delta">+{move.gp_delta}</span>}</span></td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </ShareCard>
  )
}
