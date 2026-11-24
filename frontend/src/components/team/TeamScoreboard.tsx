import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useGetRankChangesQuery } from '../../store/api/fantasyApi'
import { MyTeamMark } from '../MyTeamMark'
import { orderCategories } from '../../utils/statOrder'
import '../../mobile/team/team.css'

/** League-best is solid blue, top half light blue, bottom third orange. */
export function categoryTone(points: number, teamCount: number): string {
  if (points >= teamCount) return 'mr-tm-cat-top'
  const share = points / Math.max(teamCount, 1)
  if (share >= 0.66) return 'mr-tm-cat-high'
  if (share > 0.33) return 'mr-tm-cat-mid'
  return 'mr-tm-cat-low'
}

export interface TeamScoreboardProps {
  teamId: number
  teamName: string
  rank: number | null | undefined
  totalPoints: number
  gp: number
  teamCount: number
  categories: Record<string, number>
  espnUrl: string
  share: ReactNode
  badge: ReactNode
  /** "▲2 tonight" beside total points, when the slate is live. */
  pointsTonight: string | null
  pointsDown?: boolean
  /** "+1 tonight" beside games played. */
  gpTonight: string | null
  playingNote: string | null
  liveNote: string | null
}

/** Rank, category strength, and the night's live notes. Same block on desktop and phone. */
export function TeamScoreboard({
  teamId,
  teamName,
  rank,
  totalPoints,
  gp,
  teamCount,
  categories,
  espnUrl,
  share,
  badge,
  pointsTonight,
  pointsDown = false,
  gpTonight,
  playingNote,
  liveNote,
}: TeamScoreboardProps) {
  const navigate = useNavigate()
  const { data: changes } = useGetRankChangesQuery('averages')
  const move = changes?.teams?.find(team => team.team_id === teamId)?.rank_delta
  const cats = orderCategories(Object.keys(categories))

  return (
    <section className="mr-tm-board" aria-label="Team summary">
      <button type="button" className="mr-link mr-tm-back" onClick={() => navigate('/teams')}>
        ‹ Back to Teams
      </button>
      <div className="mr-tm-board-top">
        <div className="mr-tm-identity">
          <h1 className="mr-tm-title">
            {teamName}
            <MyTeamMark teamId={teamId} />
          </h1>
          <div className="mr-tm-figures">
            <span className="mr-tm-rank">#{rank ?? '—'}</span>
            <span className="mr-tm-points">
              {pointsTonight && (
                <span className={`mr-tm-tonight ${pointsDown ? 'mr-down' : 'mr-up'}`}>{pointsTonight}</span>
              )}
              <b>{totalPoints}</b>
              <span>pts</span>
            </span>
            {typeof move === 'number' && (
              <span
                className={`mr-tm-move ${move > 0 ? 'mr-up' : move < 0 ? 'mr-down' : 'mr-same'}`}
                title="Rank change since yesterday (averages)"
              >
                {move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '–'} since yesterday
              </span>
            )}
            <span className="mr-tm-gp">
              GP {gp}
              {gpTonight && <span className="mr-tm-tonight mr-up">{gpTonight}</span>}
            </span>
          </div>
          <div className="mr-tm-meta-row">
            {badge}
            {liveNote && <span className="mr-meta">{liveNote}</span>}
          </div>
        </div>
        <div className="mr-tm-actions">
          <span className="mr-tm-share">{share}</span>
          <a className="mr-tm-espn" href={espnUrl} target="_blank" rel="noopener noreferrer">
            ESPN
          </a>
        </div>
      </div>
      <div className="mr-tm-cats" role="list" aria-label="Category points">
        {cats.map(category => (
          <div
            key={category}
            role="listitem"
            className={`mr-tm-cat ${categoryTone(categories[category], teamCount)}`}
            aria-label={`${category}: ${categories[category]} points`}
          >
            <span>{category}</span>
            <b>{categories[category]}</b>
          </div>
        ))}
      </div>
      {playingNote && (
        <p className="mr-tm-playing" data-testid="starters-playing-note">{playingNote}</p>
      )}
    </section>
  )
}
