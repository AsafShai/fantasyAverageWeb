import { ShareCard, type ShareCardTheme } from './ShareCard'
import { formatCardValue, formatPoints, rotoPlace, rotoTone } from './shareCardFormat'

export interface TeamShareCategory {
  category: string
  value: number | undefined
  /** Roto points in the category: `teamCount` for first, 1 for last. */
  points: number
}

interface TeamShareCardProps extends ShareCardTheme {
  teamName: string
  rank: number
  totalPoints: number
  teamCount: number
  categories: TeamShareCategory[]
  gp: number
  asOf: string
}

/** One team's roto report: overall rank, roto points, and a bar per
 * category showing how close the team is to first. */
export const TeamShareCard = ({ teamName, rank, totalPoints, teamCount, categories, gp, asOf, dark }: TeamShareCardProps) => (
  <ShareCard
    dark={dark}
    kicker="Team report"
    title={teamName}
    subtitle={`Season averages · as of ${asOf}`}
    footer={<><span>Bar = how close to 1st in the league</span><span>GP {gp}</span></>}
  >
    <div className="share-card__tiles">
      <div className="share-card__tile">
        <div className="share-card__label">Overall</div>
        <span className="share-card__big">#{rank}</span> <span className="share-card__of">of {teamCount}</span>
      </div>
      <div className="share-card__tile">
        <div className="share-card__label">Roto points</div>
        <span className="share-card__big">{formatPoints(totalPoints)}</span>{' '}
        <span className="share-card__of">of {teamCount * categories.length}</span>
      </div>
    </div>
    <div className="share-card__bars">
      {categories.map(({ category, value, points }) => {
        const tone = rotoTone(points, teamCount)
        const pct = teamCount > 1 ? ((points - 1) / (teamCount - 1)) * 100 : 100
        return (
          <div key={category} className="share-card__bar">
            <span className="share-card__bar-key">{category}</span>
            <span className="share-card__track">
              <span
                className={`share-card__fill${tone ? ` share-card__fill--${tone}` : ''}`}
                style={{ display: 'block', width: `${Math.max(pct, 4)}%` }}
              />
            </span>
            <span className="share-card__bar-value">{value === undefined ? '–' : formatCardValue(category, value, 'averages')}</span>
            <span className="share-card__bar-rank">#{rotoPlace(points, teamCount)}</span>
          </div>
        )
      })}
    </div>
  </ShareCard>
)
