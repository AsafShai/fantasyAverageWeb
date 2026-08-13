import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { getErrorMessage } from '../../utils/errorMessage'
import { useMinigamePlayers } from '../../minigames/useMinigamePlayers'
import { pickRandomPlayer } from '../../minigames/players'
import { createStreakState, incrementHints, onRoundLoss, onRoundWin } from '../../minigames/streak'
import { useRunEnd } from '../../minigames/useRunEnd'
import { HANGMAN_MAX_WRONG, type MinigamePlayer } from '../../minigames/types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const HINTS = [
  { bit: 0, label: 'Conference' },
  { bit: 1, label: 'Team' },
  { bit: 2, label: 'Position' },
  { bit: 3, label: 'Photo' },
] as const

function lettersInName(name: string): Set<string> {
  const set = new Set<string>()
  for (const ch of name.toUpperCase()) {
    if (ch >= 'A' && ch <= 'Z') set.add(ch)
  }
  return set
}

function HangmanFigure({ wrong }: { wrong: number }) {
  return (
    <svg viewBox="0 0 100 120" className="w-28 h-36 mx-auto text-gray-800 dark:text-gray-200">
      <line x1="10" y1="110" x2="90" y2="110" stroke="currentColor" strokeWidth="3" />
      <line x1="30" y1="110" x2="30" y2="10" stroke="currentColor" strokeWidth="3" />
      <line x1="30" y1="10" x2="70" y2="10" stroke="currentColor" strokeWidth="3" />
      <line x1="70" y1="10" x2="70" y2="25" stroke="currentColor" strokeWidth="3" />
      {wrong >= 1 && <circle cx="70" cy="35" r="10" fill="none" stroke="currentColor" strokeWidth="2" />}
      {wrong >= 2 && <line x1="70" y1="45" x2="70" y2="75" stroke="currentColor" strokeWidth="2" />}
      {wrong >= 3 && <line x1="70" y1="55" x2="55" y2="65" stroke="currentColor" strokeWidth="2" />}
      {wrong >= 4 && <line x1="70" y1="55" x2="85" y2="65" stroke="currentColor" strokeWidth="2" />}
      {wrong >= 5 && <line x1="70" y1="75" x2="55" y2="95" stroke="currentColor" strokeWidth="2" />}
      {wrong >= 6 && <line x1="70" y1="75" x2="85" y2="95" stroke="currentColor" strokeWidth="2" />}
      {wrong >= 7 && (
        <>
          <line x1="66" y1="32" x2="70" y2="36" stroke="currentColor" strokeWidth="2" />
          <line x1="70" y1="32" x2="66" y2="36" stroke="currentColor" strokeWidth="2" />
          <line x1="70" y1="32" x2="74" y2="36" stroke="currentColor" strokeWidth="2" />
          <line x1="74" y1="32" x2="70" y2="36" stroke="currentColor" strokeWidth="2" />
        </>
      )}
    </svg>
  )
}

export default function HangmanGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('hangman')

  const [phase, setPhase] = useState<'lobby' | 'playing' | 'won'>('lobby')
  const [player, setPlayer] = useState<MinigamePlayer | null>(null)
  const [guessed, setGuessed] = useState<Set<string>>(new Set())
  const [wrong, setWrong] = useState(0)
  const [hintMask, setHintMask] = useState(0)
  const [streak, setStreak] = useState(createStreakState())
  const [autoMode, setAutoMode] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)

  const needed = useMemo(() => (player ? lettersInName(player.displayName) : new Set<string>()), [player])

  const startRound = useCallback(
    (excludeId?: string) => {
      if (!players.length) return
      const next = pickRandomPlayer(players, excludeId)
      setPlayer(next)
      setGuessed(new Set())
      setWrong(0)
      setHintMask(0)
      setPhase('playing')
      setCountdown(null)
    },
    [players],
  )

  const startNewGame = () => {
    runEnd.clearFinal()
    setStreak(createStreakState())
    startRound()
  }

  const endRun = useCallback(
    (s = streak) => {
      setPhase('lobby')
      void runEnd.handleRunEnd({
        bestStreak: s.bestStreak,
        hintsUsed: s.minHintsForBestTie ?? s.runHintsUsed,
      })
      setStreak(onRoundLoss(s))
    },
    [runEnd, streak],
  )

  const goNext = useCallback(() => {
    startRound(player?.id)
  }, [player?.id, startRound])

  useEffect(() => {
    if (phase !== 'won' || !autoMode) return
    setCountdown(3)
    const t = setInterval(() => {
      setCountdown((c) => {
        if (c == null) return null
        if (c <= 1) {
          clearInterval(t)
          goNext()
          return null
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [phase, autoMode, goNext])

  const onLetter = (letter: string) => {
    if (phase !== 'playing' || !player || guessed.has(letter)) return
    const nextGuessed = new Set(guessed)
    nextGuessed.add(letter)
    setGuessed(nextGuessed)

    if (!needed.has(letter)) {
      const w = wrong + 1
      setWrong(w)
      if (w >= HANGMAN_MAX_WRONG) endRun()
      return
    }

    const allFound = [...needed].every((l) => nextGuessed.has(l))
    if (allFound) {
      const nextStreak = onRoundWin(streak)
      setStreak(nextStreak)
      setPhase('won')
    }
  }

  const useHint = (bit: number) => {
    if (phase !== 'playing' || (hintMask & (1 << bit)) !== 0) return
    setHintMask((m) => m | (1 << bit))
    setStreak((s) => incrementHints(s))
  }

  if (isLoading) return <LoadingSpinner />
  if (error || !players.length) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players')} />

  return (
    <div className="max-w-5xl mx-auto px-4 pb-12">
      <div className="mb-4">
        <Link to="/minigames" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          ← Minigames
        </Link>
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">
            Hangman
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">Guess the NBA player — build a streak</p>

          <div className="flex flex-wrap gap-4 text-sm mb-4">
            <span className="font-semibold text-gray-800 dark:text-gray-100">
              Streak: {streak.currentStreak}
            </span>
            <span className="text-gray-500">Best this run: {streak.bestStreak}</span>
            <span className="text-gray-500">Hints used: {streak.runHintsUsed}</span>
            <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 cursor-pointer">
              <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
              Auto next (3s)
            </label>
          </div>

          {phase === 'lobby' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center bg-white dark:bg-gray-900">
              {runEnd.finalScore != null && (
                <p className="mb-4 text-lg text-gray-800 dark:text-gray-100">
                  Run over — best streak: <strong>{runEnd.finalScore}</strong>
                </p>
              )}
              <button
                type="button"
                onClick={startNewGame}
                className="px-6 py-3 rounded-md bg-blue-600 text-white font-semibold"
              >
                Start New Game
              </button>
            </div>
          )}

          {(phase === 'playing' || phase === 'won') && player && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 bg-white dark:bg-gray-900">
              <HangmanFigure wrong={wrong} />
              <div className="flex flex-wrap justify-center gap-1.5 my-4 text-2xl font-mono tracking-widest">
                {player.displayName.split('').map((ch, i) => {
                  const up = ch.toUpperCase()
                  const isLetter = up >= 'A' && up <= 'Z'
                  const show = !isLetter || guessed.has(up) || phase === 'won'
                  return (
                    <span
                      key={i}
                      className={`min-w-[1.1rem] text-center border-b-2 ${
                        isLetter ? 'border-gray-400' : 'border-transparent'
                      }`}
                    >
                      {show ? ch : ''}
                    </span>
                  )
                })}
              </div>

              {phase === 'playing' && (
                <>
                  <div className="flex flex-wrap gap-2 justify-center mb-4">
                    {HINTS.map((h) => {
                      const used = (hintMask & (1 << h.bit)) !== 0
                      return (
                        <button
                          key={h.bit}
                          type="button"
                          disabled={used}
                          onClick={() => useHint(h.bit)}
                          className="px-2 py-1 text-xs rounded border border-dashed border-gray-400 disabled:opacity-40"
                        >
                          {h.label}
                        </button>
                      )
                    })}
                  </div>
                  <div className="space-y-1 text-sm text-center text-gray-600 dark:text-gray-300 mb-4 min-h-[4.5rem]">
                    {(hintMask & 1) !== 0 && <p>Conference: {player.conference}</p>}
                    {(hintMask & 2) !== 0 && <p>Team: {player.team}</p>}
                    {(hintMask & 4) !== 0 && <p>Position: {player.position}</p>}
                    {(hintMask & 8) !== 0 && player.photoUrl && (
                      <img
                        src={player.photoUrl}
                        alt=""
                        className="w-20 h-20 mx-auto rounded-full object-cover object-top"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-9 gap-1 max-w-md mx-auto mb-4">
                    {LETTERS.map((L) => (
                      <button
                        key={L}
                        type="button"
                        disabled={guessed.has(L)}
                        onClick={() => onLetter(L)}
                        className="py-1.5 text-xs font-semibold rounded bg-gray-100 dark:bg-gray-800 disabled:opacity-30 hover:bg-blue-100 dark:hover:bg-gray-700"
                      >
                        {L}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => endRun()}
                    className="block mx-auto text-sm text-red-600 hover:underline"
                  >
                    Give up
                  </button>
                </>
              )}

              {phase === 'won' && (
                <div className="text-center">
                  <p className="text-green-600 font-semibold mb-2">Correct!</p>
                  {countdown != null && <p className="text-sm text-gray-500 mb-2">Next in {countdown}…</p>}
                  <button
                    type="button"
                    onClick={goNext}
                    className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium"
                  >
                    Next player
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="lg:w-72 shrink-0">
          <LeaderboardCard
            gameSlug="hangman"
            description="Top 5 best streaks (fewer hints wins ties)"
          />
        </div>
      </div>

      <NameEntryModal
        open={runEnd.showNameModal}
        bestStreak={runEnd.pendingScore ?? 0}
        submitting={runEnd.submitting}
        error={runEnd.submitError}
        onSubmit={runEnd.submitName}
        onDismiss={runEnd.dismissModal}
      />
    </div>
  )
}
