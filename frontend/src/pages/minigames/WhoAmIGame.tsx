import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import {
  NbaConferenceDivisionMapDialog,
  NbaMapInfoButton,
} from '../../components/minigames/NbaConferenceDivisionMapDialog'
import PlayerPicker from '../../components/minigames/PlayerPicker'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { getErrorMessage } from '../../utils/errorMessage'
import { useConferenceDivisionTree } from '../../minigames/conferenceDivisionTree'
import { useMinigamePlayers } from '../../minigames/useMinigamePlayers'
import { pickRandomPlayer } from '../../minigames/players'
import { createStreakState, incrementHints, onRoundLoss, onRoundWin } from '../../minigames/streak'
import { useRunEnd } from '../../minigames/useRunEnd'
import { computeWhoAmIFeedback, WHO_AM_I_COLUMNS } from '../../minigames/whoAmIFeedback'
import { computeWhoAmIMapExclusions } from '../../minigames/whoAmIMapExclusions'
import {
  WHO_AM_I_MAX_GUESSES,
  type MinigamePlayer,
  type WhoAmIColumnKey,
  type WhoAmIGuessRow,
} from '../../minigames/types'

function cellClass(state: string) {
  if (state === 'correct') return 'bg-green-200 dark:bg-green-800/60 text-green-900 dark:text-green-100'
  if (state === 'close') return 'bg-amber-200 dark:bg-amber-800/60 text-amber-900 dark:text-amber-100'
  return 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'
}

function dirArrow(dir?: 'higher' | 'lower') {
  if (dir === 'higher') return ' ↑'
  if (dir === 'lower') return ' ↓'
  return ''
}

function ColumnHeader({
  colKey,
  label,
  onOpenMap,
}: {
  colKey: WhoAmIColumnKey
  label: string
  onOpenMap: () => void
}) {
  const showInfo = colKey === 'conference' || colKey === 'division'
  return (
    <th className="p-1 text-center">
      <span className="inline-flex items-center justify-center gap-0.5">
        {label}
        {showInfo && <NbaMapInfoButton onOpen={onOpenMap} />}
      </span>
    </th>
  )
}

export default function WhoAmIGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('who-am-i')
  const tree = useConferenceDivisionTree(players)

  const [phase, setPhase] = useState<'lobby' | 'playing' | 'won'>('lobby')
  const [secret, setSecret] = useState<MinigamePlayer | null>(null)
  const [rows, setRows] = useState<WhoAmIGuessRow[]>([])
  const [photoHint, setPhotoHint] = useState(false)
  const [streak, setStreak] = useState(createStreakState())
  const [autoMode, setAutoMode] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [mapOpen, setMapOpen] = useState(false)

  const clueExclusions = useMemo(
    () => computeWhoAmIMapExclusions(players, rows),
    [players, rows],
  )

  const startRound = useCallback(
    (excludeId?: string) => {
      if (!players.length) return
      setSecret(pickRandomPlayer(players, excludeId))
      setRows([])
      setPhotoHint(false)
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

  const goNext = useCallback(() => startRound(secret?.id), [secret?.id, startRound])

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

  const onGuess = (guess: MinigamePlayer) => {
    if (phase !== 'playing' || !secret) return
    if (rows.some((r) => r.guessedPlayerId === guess.id)) return

    if (guess.id === secret.id) {
      const feedback = computeWhoAmIFeedback(secret, guess)
      setRows((r) => [...r, feedback])
      const next = onRoundWin(streak)
      setStreak(next)
      setPhase('won')
      return
    }

    const feedback = computeWhoAmIFeedback(secret, guess)
    const nextRows = [...rows, feedback]
    setRows(nextRows)
    if (nextRows.length >= WHO_AM_I_MAX_GUESSES) {
      endRun()
    }
  }

  const usePhotoHint = () => {
    if (photoHint || phase !== 'playing') return
    setPhotoHint(true)
    setStreak((s) => incrementHints(s))
  }

  if (isLoading) return <LoadingSpinner />
  if (error || !players.length) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players')} />

  return (
    <div className="max-w-6xl mx-auto px-4 pb-12">
      <div className="mb-4">
        <Link to="/minigames" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          ← Minigames
        </Link>
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-1">
            Who Am I?
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Poeltl-style clues — {WHO_AM_I_MAX_GUESSES} guesses
          </p>
          <div className="flex flex-wrap items-center gap-4 text-sm mb-4">
            <span className="font-semibold">Streak: {streak.currentStreak}</span>
            <span className="text-gray-500">Best: {streak.bestStreak}</span>
            <span className="text-gray-500">Hints: {streak.runHintsUsed}</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={autoMode} onChange={(e) => setAutoMode(e.target.checked)} />
              Auto next
            </label>
            <button
              type="button"
              onClick={() => setMapOpen(true)}
              className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              <span aria-hidden>ⓘ</span> View map
            </button>
          </div>

          {phase === 'lobby' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center bg-white dark:bg-gray-900">
              {runEnd.finalScore != null && (
                <p className="mb-2 text-lg">
                  Run over — best streak: <strong>{runEnd.finalScore}</strong>
                </p>
              )}
              {secret && runEnd.finalScore != null && (
                <div className="mb-4 flex flex-col items-center gap-2">
                  {secret.photoUrl && (
                    <img
                      src={secret.photoUrl}
                      alt=""
                      className="w-20 h-20 rounded-full object-cover object-top"
                    />
                  )}
                  <p className="text-sm text-gray-600">Answer: <strong>{secret.displayName}</strong></p>
                </div>
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

          {(phase === 'playing' || phase === 'won') && secret && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 bg-white dark:bg-gray-900 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <PlayerPicker
                  players={players}
                  excludeIds={rows.map((r) => r.guessedPlayerId)}
                  hideHeadshot={photoHint}
                  disabled={phase !== 'playing'}
                  onGuess={onGuess}
                />
                <button
                  type="button"
                  disabled={photoHint || phase !== 'playing'}
                  onClick={usePhotoHint}
                  className="px-3 py-2 text-xs rounded border border-dashed border-gray-400 disabled:opacity-40"
                >
                  Photo hint
                </button>
                {phase === 'playing' && (
                  <button
                    type="button"
                    onClick={() => endRun()}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Give up
                  </button>
                )}
              </div>

              {photoHint && secret.photoUrl && (
                <img
                  src={secret.photoUrl}
                  alt="Hint"
                  className="w-24 h-24 rounded-full object-cover object-top"
                />
              )}

              {/* Desktop guess table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="p-1">Guess</th>
                      {WHO_AM_I_COLUMNS.map((c) => (
                        <ColumnHeader
                          key={c.key}
                          colKey={c.key}
                          label={c.label}
                          onOpenMap={() => setMapOpen(true)}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.guessedPlayerId}>
                        <td className="p-1 font-medium whitespace-nowrap">{row.guessedName}</td>
                        {WHO_AM_I_COLUMNS.map((c) => {
                          const cell = row.feedback[c.key]
                          return (
                            <td key={c.key} className="p-1">
                              <div
                                className={`rounded px-1 py-1 text-center whitespace-nowrap ${cellClass(cell.state)}`}
                              >
                                {row.display[c.key]}
                                {dirArrow(cell.dir)}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-2">
                  Guesses: {rows.length}/{WHO_AM_I_MAX_GUESSES}
                </p>
              </div>

              {/* Mobile guess cards */}
              <div className="sm:hidden space-y-3">
                {rows.map((row) => (
                  <div
                    key={row.guessedPlayerId}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2"
                  >
                    <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                      {row.guessedName}
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      {WHO_AM_I_COLUMNS.map((c) => {
                        const cell = row.feedback[c.key]
                        const showInfo = c.key === 'conference' || c.key === 'division'
                        return (
                          <div key={c.key}>
                            <div className="mb-0.5 flex items-center gap-0.5 text-[10px] uppercase text-gray-500">
                              {c.label}
                              {showInfo && <NbaMapInfoButton onOpen={() => setMapOpen(true)} />}
                            </div>
                            <div
                              className={`rounded px-1.5 py-1 text-center ${cellClass(cell.state)}`}
                            >
                              {row.display[c.key]}
                              {dirArrow(cell.dir)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-gray-400">
                  Guesses: {rows.length}/{WHO_AM_I_MAX_GUESSES}
                </p>
              </div>

              {phase === 'won' && (
                <div className="text-center pt-2">
                  <p className="text-green-600 font-semibold mb-2">You got it — {secret.displayName}!</p>
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
            gameSlug="who-am-i"
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
      <NbaConferenceDivisionMapDialog
        open={mapOpen}
        onOpenChange={setMapOpen}
        tree={tree}
        clueExclusions={clueExclusions}
      />
    </div>
  )
}
