import { useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { GameSlug } from '../../minigames/types'
import { ensureMobileFonts } from '../fonts'
import { Button, Card } from '../ui'
import MobileLeaderboard from './MobileLeaderboard'
import './minigames.css'

interface Props {
  slug: GameSlug
  title: string
  subtitle: ReactNode
  /** Today's streak line ("Streak", "Best", "Hints used" …), as tiles; the first is the live one. */
  stats: { label: string; value: number }[]
  /** Auto next / View map: shown under the game in every phase. */
  controls?: ReactNode
  /** Lobby (Start New Game) vs a round in progress. */
  lobby: boolean
  /** Lobby: the run-over line and answer reveal, above Start New Game. */
  runOver?: ReactNode
  onStart: () => void
  /** The round itself (shared with desktop). */
  board?: ReactNode
  leaderboardDescription: string
  /** Name entry modal, map sheet … */
  children?: ReactNode
}

/**
 * Phone layout shared by the four game pages (step 5): back link, title, one
 * game card (streak tiles, lobby or board, toggles) and the leaderboard card.
 * Each page keeps its game logic and hands the pieces in.
 */
export default function MinigamePageMobile({
  slug, title, subtitle, stats, controls, lobby, runOver, onStart, board, leaderboardDescription, children,
}: Props) {
  const navigate = useNavigate()
  useEffect(() => ensureMobileFonts(), [])
  return (
    <div className="mr-root mr-mg" data-testid="mobile-minigame">
      <button type="button" className="mr-link mr-mg-back" onClick={() => navigate('/minigames')}>
        ‹ Minigames
      </button>
      <div className="mr-mg-head">
        <h1 className="mr-h1">{title}</h1>
        <span className="mr-meta">{subtitle}</span>
      </div>
      <Card aria-label={`${title} game`}>
        <div className="mr-mg-stats">
          {stats.map((s, i) => (
            <div key={s.label} className={`mr-mg-stat ${i === 0 ? 'mr-on' : ''}`.trim()}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
        {lobby ? (
          <div className="mr-mg-lobby">
            <span className="mr-mg-ball" aria-hidden="true">🏀</span>
            {runOver}
            <Button variant="primary" onClick={onStart}>Start New Game</Button>
          </div>
        ) : (
          <div className="mr-mg-board">{board}</div>
        )}
        {controls && <div className="mr-mg-controls">{controls}</div>}
      </Card>
      <MobileLeaderboard gameSlug={slug} description={leaderboardDescription} />
      {children}
    </div>
  )
}
