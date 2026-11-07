import type { ReactNode } from 'react'
import type { BoxScoreGame, BoxTeamSide } from '../../types/boxScore'
import SlateDatePicker from '../../components/boxScores/SlateDatePicker'
import { gameClockLabel } from '../../components/boxScores/tipTime'
import { Segmented } from '../ui'
import './nba.css'

export interface MobileGameCard {
  game: BoxScoreGame
  selected: boolean
  hideScores: boolean
  mineCount: number | null
}

interface MobileBoxScoresProps {
  noSpoilers: boolean
  onNoSpoilers: (next: boolean) => void
  date: string
  dateLabel: string
  min?: string
  max?: string
  prevDate: string | null
  nextDate: string | null
  /** Shown when the slate is not today and today is in season. */
  showToday: boolean
  onGoTo: (date: string) => void
  onGoToday: () => void
  /** Spinner / error / "No NBA games" for the slate. */
  status: ReactNode
  cards: MobileGameCard[] | null
  onToggleGame: (gameId: string) => void
  /** The open game's box (or its spinner / error). */
  panel: ReactNode
  /** Lines of the night and My players, as on desktop. */
  extras: ReactNode
}

function teamColor(color: string): string | undefined {
  return /^[0-9A-Fa-f]{6}$/.test(color) ? `#${color}` : undefined
}

/**
 * Box Scores on a phone (step 5): Full box / No spoilers, date stepper, game
 * cards with logos and team colours scrolling sideways, then the open game's
 * box under the cards. Data and URL (?date, ?game) stay in pages/BoxScores.
 */
export default function MobileBoxScores(props: MobileBoxScoresProps) {
  const { noSpoilers, onNoSpoilers, date, dateLabel, min, max, prevDate, nextDate, showToday, onGoTo, onGoToday, status, cards, onToggleGame, panel, extras } = props
  return (
    <div className="mr-root mr-nba" data-testid="mobile-box-scores">
      <div className="mr-nba-head">
        <h1 className="mr-nba-title">Box Scores</h1>
        <p className="mr-nba-lede">
          {noSpoilers ? 'Names only. Scores and stats stay hidden.' : 'Every NBA game on the slate, with the full box.'}
        </p>
      </div>

      <Segmented
        label="Spoiler visibility"
        options={[{ value: 'full', label: 'Full box' }, { value: 'hide', label: '🚫 No spoilers' }]}
        value={noSpoilers ? 'hide' : 'full'}
        onChange={(v) => onNoSpoilers(v === 'hide')}
        className="mr-nba-grow-0"
      />

      <div className="mr-nba-datenav">
        <button type="button" className="mr-btn mr-nba-sq" aria-label="Previous day" disabled={!prevDate} onClick={() => prevDate && onGoTo(prevDate)}>‹</button>
        <SlateDatePicker date={date} label={dateLabel} min={min} max={max} onChange={onGoTo} />
        <button type="button" className="mr-btn mr-nba-sq" aria-label="Next day" disabled={!nextDate} onClick={() => nextDate && onGoTo(nextDate)}>›</button>
        {showToday && <button type="button" className="mr-btn mr-nba-today" onClick={onGoToday}>Today</button>}
      </div>

      {status}

      {cards && cards.length > 0 && (
        <>
          <div className="mr-nba-games mr-noscroll" role="group" aria-label="Games">
            {cards.map(({ game, selected, hideScores, mineCount }) => {
              const hide = hideScores && game.status !== 'scheduled'
              return (
                <button
                  key={game.game_id}
                  type="button"
                  className="mr-nba-gc"
                  aria-pressed={selected}
                  onClick={() => onToggleGame(game.game_id)}
                >
                  <span className={`mr-nba-gc-when ${game.status === 'live' ? 'mr-nba-live' : ''}`.trim()}>
                    {gameClockLabel(game.status, game.status_detail, game.start_time)}
                  </span>
                  <SideRow team={game.away} hide={hide} />
                  <SideRow team={game.home} hide={hide} />
                  {mineCount != null && mineCount > 0 && (
                    <span className="mr-nba-gc-mine"><i aria-hidden="true" />{mineCount} from your team</span>
                  )}
                </button>
              )
            })}
          </div>
          {extras}
          {panel}
        </>
      )}
    </div>
  )
}

function SideRow({ team, hide }: { team: BoxTeamSide; hide: boolean }) {
  const won = team.winner && !hide
  return (
    <span className={`mr-nba-gc-side ${won ? 'mr-nba-won' : ''}`.trim()}>
      <span className="mr-nba-tbar" style={{ background: teamColor(team.color) ?? 'var(--mr-border)' }} />
      {team.logo ? <img src={team.logo} alt="" className="mr-nba-gc-logo" /> : <span className="mr-nba-gc-logo" />}
      <b>{team.abbreviation}</b>
      <span className="mr-nba-gc-score">
        {hide ? (
          <span aria-label="Score hidden" title="Hidden while No spoilers is on">–</span>
        ) : team.score == null ? '–' : team.score}
      </span>
    </span>
  )
}
