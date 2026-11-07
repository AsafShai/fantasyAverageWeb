import AutoNextToggle from './AutoNextToggle'

const HINTS = [
  { bit: 0, label: 'Conf' },
  { bit: 1, label: 'Team' },
  { bit: 2, label: 'Pos' },
  { bit: 3, label: 'Photo' },
] as const

type Props = {
  hintMask: number
  onHint: (bit: number) => void
  hintsEnabled: boolean
  wrongCount: number
  maxWrong: number
  showGiveUp: boolean
  onGiveUp: () => void
  autoNext: boolean
  onAutoNextChange: (next: boolean) => void
  /** While guessing: hints + misses. After a win: auto-next only. */
  showHintRow: boolean
}

/** Hangman — toolbar above the letter grid (matches Who Am I mobile pattern). */
export default function HangmanMobileToolbar({
  hintMask,
  onHint,
  hintsEnabled,
  wrongCount,
  maxWrong,
  showGiveUp,
  onGiveUp,
  autoNext,
  onAutoNextChange,
  showHintRow,
}: Props) {
  const urgent = wrongCount >= maxWrong - 2

  return (
    <div className={`mg-game-toolbar ${showHintRow ? '' : 'mg-game-toolbar--compact'}`.trim()}>
      {showHintRow ? (
        <div className="mg-game-toolbar__top">
          <div className="mg-game-toolbar__hint-block">
            <span className="mg-game-toolbar__stat-label" id="hangman-hints-label">
              Hints
            </span>
            <div
              className="mg-game-toolbar__hints"
              role="group"
              aria-labelledby="hangman-hints-label"
              aria-description="Each hint counts toward your leaderboard hint total"
            >
            {HINTS.map((h) => {
              const used = (hintMask & (1 << h.bit)) !== 0
              return (
                <button
                  key={h.bit}
                  type="button"
                  disabled={!hintsEnabled || used}
                  onClick={() => onHint(h.bit)}
                  className={`mg-game-toolbar__chip mg-game-toolbar__chip--hint ${
                    used ? 'mg-game-toolbar__chip--used' : ''
                  }`.trim()}
                  aria-pressed={used}
                >
                  {used ? (
                    <>
                      <span aria-hidden>✓</span> {h.label}
                    </>
                  ) : (
                    h.label
                  )}
                </button>
              )
            })}
            </div>
          </div>
          <p
            className={`mg-game-toolbar__stat ${urgent ? 'mg-game-toolbar__stat--urgent' : ''}`.trim()}
            aria-label={`${wrongCount} of ${maxWrong} wrong letters`}
          >
            <span className="mg-game-toolbar__stat-label">Misses</span>
            <span className="mg-game-toolbar__stat-count">
              <span className="mg-game-toolbar__stat-n">{wrongCount}</span>
              <span className="mg-game-toolbar__stat-sep" aria-hidden>
                /
              </span>
              <span className="mg-game-toolbar__stat-max">{maxWrong}</span>
            </span>
          </p>
        </div>
      ) : null}
      <div
        className={`mg-game-toolbar__bottom ${showHintRow ? '' : 'mg-game-toolbar__bottom--solo'}`.trim()}
      >
        {showGiveUp ? (
          <button
            type="button"
            onClick={onGiveUp}
            className="mg-game-toolbar__chip mg-game-toolbar__chip--muted"
          >
            Give up
          </button>
        ) : (
          <span className="min-w-0 flex-1" aria-hidden />
        )}
        <AutoNextToggle
          compact
          checked={autoNext}
          onChange={onAutoNextChange}
          label="Auto next (3s)"
        />
      </div>
    </div>
  )
}
