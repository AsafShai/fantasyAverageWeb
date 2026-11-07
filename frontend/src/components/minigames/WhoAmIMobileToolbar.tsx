import AutoNextToggle from './AutoNextToggle'

type Props = {
  guessCount: number
  maxGuesses: number
  photoHintUsed: boolean
  canPhotoHint: boolean
  onPhotoHint: () => void
  showGiveUp: boolean
  onGiveUp: () => void
  autoNext: boolean
  onAutoNextChange: (next: boolean) => void
  onOpenMap: () => void
}

/** Who Am I — compact toolbar above the mobile guess list. */
export default function WhoAmIMobileToolbar({
  guessCount,
  maxGuesses,
  photoHintUsed,
  canPhotoHint,
  onPhotoHint,
  showGiveUp,
  onGiveUp,
  autoNext,
  onAutoNextChange,
  onOpenMap,
}: Props) {
  return (
    <div className="mg-game-toolbar">
      <div className="mg-game-toolbar__top">
        <div className="mg-game-toolbar__actions">
          <button
            type="button"
            disabled={photoHintUsed || !canPhotoHint}
            onClick={onPhotoHint}
            className="mg-game-toolbar__chip"
          >
            Photo hint
          </button>
          {showGiveUp ? (
            <button type="button" onClick={onGiveUp} className="mg-game-toolbar__chip mg-game-toolbar__chip--muted">
              Give up
            </button>
          ) : null}
        </div>
        <p
          className="mg-game-toolbar__stat"
          aria-label={`${guessCount} of ${maxGuesses} guesses used`}
        >
          <span className="mg-game-toolbar__stat-label">Guesses</span>
          <span className="mg-game-toolbar__stat-count">
            <span className="mg-game-toolbar__stat-n">{guessCount}</span>
            <span className="mg-game-toolbar__stat-sep" aria-hidden>
              /
            </span>
            <span className="mg-game-toolbar__stat-max">{maxGuesses}</span>
          </span>
        </p>
      </div>
      <div className="mg-game-toolbar__bottom">
        <AutoNextToggle
          compact
          checked={autoNext}
          onChange={onAutoNextChange}
          label="Auto next (3s)"
        />
        <button type="button" onClick={onOpenMap} className="mg-game-toolbar__chip mg-game-toolbar__chip--map">
          <span aria-hidden>ⓘ</span>
          Map
        </button>
      </div>
    </div>
  )
}
