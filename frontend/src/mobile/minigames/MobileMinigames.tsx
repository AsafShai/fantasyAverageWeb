import { useEffect } from 'react'
import { Link } from 'react-router'
import { ensureMobileFonts } from '../fonts'
import './minigames.css'

export interface MinigameEntry {
  slug: string
  title: string
  emoji: string
  description: string
}

/** Phone Minigames list (step 5): same heading, intro and four games as today, one card per game. */
export default function MobileMinigames({ games }: { games: readonly MinigameEntry[] }) {
  useEffect(() => ensureMobileFonts(), [])
  return (
    <div className="mr-root mr-mg" data-testid="mobile-minigames">
      <div className="mr-mg-head">
        <h1 className="mr-mg-grad">Minigames</h1>
        <p className="mr-mg-lead">Play NBA guessing games and climb each game&apos;s top-5 streak leaderboard</p>
      </div>
      <ul className="mr-mg-list">
        {games.map((g) => (
          <li key={g.slug}>
            <Link to={`/minigames/${g.slug}`} className="mr-mg-game">
              <span className="mr-mg-emo" aria-hidden="true">{g.emoji}</span>
              <span className="mr-mg-name">{g.title}</span>
              <span className="mr-meta">{g.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
