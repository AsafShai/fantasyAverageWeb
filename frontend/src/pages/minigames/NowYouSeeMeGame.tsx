import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import PlayerPicker from '../../components/minigames/PlayerPicker'
import TimerBar from '../../components/minigames/TimerBar'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { useMinigamePlayers } from '../../minigames/useMinigamePlayers'
import { pickRandomPlayerWithPhoto, playersWithPhotos } from '../../minigames/players'
import { createStreakState, onRoundLoss, onRoundWin } from '../../minigames/streak'
import { useRunEnd } from '../../minigames/useRunEnd'
import { NOW_YOU_SEE_ME_ROUND_SECONDS, type MinigamePlayer } from '../../minigames/types'

export default function NowYouSeeMeGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('now-you-see-me')
  const photoPlayers = playersWithPhotos(players)

  const [phase, setPhase] = useState<'lobby' | 'playing'>('lobby')
  const [player, setPlayer] = useState<MinigamePlayer | null>(null)
  const [timerKey, setTimerKey] = useState(0)
  const [streak, setStreak] = useState(createStreakState())
  const [reveal, setReveal] = useState<MinigamePlayer | null>(null)

  const startRound = useCallback(
    (excludeId?: string) => {
      if (!photoPlayers.length) return
      setPlayer(pickRandomPlayerWithPhoto(photoPlayers, excludeId))
      setTimerKey((k) => k + 1)
      setReveal(null)
      setPhase('playing')
    },
    [photoPlayers],
  )

  const startNewGame = () => {
    runEnd.clearFinal()
    setStreak(createStreakState())
    startRound()
  }

  const endRun = useCallback(
    (answer?: MinigamePlayer | null, s = streak) => {
      setReveal(answer ?? player)
      setPhase('lobby')
      void runEnd.handleRunEnd({ bestStreak: s.bestStreak })
      setStreak(onRoundLoss(s))
    },
    [player, runEnd, streak],
  )

  const onGuess = (guess: MinigamePlayer) => {
    if (phase !== 'playing' || !player) return
    if (guess.id === player.id) {
      const next = onRoundWin(streak)
      setStreak(next)
      startRound(player.id)
    } else {
      endRun(player)
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error || !players.length) return <ErrorMessage message="Failed to load players" />
  if (!photoPlayers.length) return <ErrorMessage message="No players with photos available" />

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
            Now You See Me
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Name the player from their photo — {NOW_YOU_SEE_ME_ROUND_SECONDS}s
          </p>
          <div className="flex gap-4 text-sm mb-4">
            <span className="font-semibold">Streak: {streak.currentStreak}</span>
            <span className="text-gray-500">Best: {streak.bestStreak}</span>
          </div>

          {phase === 'lobby' && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center bg-white dark:bg-gray-900">
              {runEnd.finalScore != null && (
                <p className="mb-2 text-lg">
                  Run over — best streak: <strong>{runEnd.finalScore}</strong>
                </p>
              )}
              {reveal && (
                <div className="mb-4 flex flex-col items-center gap-2">
                  {reveal.photoUrl && (
                    <img
                      src={reveal.photoUrl}
                      alt=""
                      className="w-24 h-24 rounded-full object-cover object-top"
                    />
                  )}
                  <p className="text-sm text-gray-600">
                    Answer: <strong>{reveal.displayName}</strong>
                  </p>
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

          {phase === 'playing' && player && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 bg-white dark:bg-gray-900 space-y-4">
              <TimerBar
                totalSeconds={NOW_YOU_SEE_ME_ROUND_SECONDS}
                running
                resetKey={timerKey}
                onTimeout={() => endRun(player)}
              />
              <div className="flex justify-center py-4">
                <img
                  src={player.photoUrl!}
                  alt="Mystery player"
                  className="w-40 h-40 sm:w-52 sm:h-52 rounded-full object-cover object-top border-4 border-gray-200 dark:border-gray-700"
                />
              </div>
              <div className="flex justify-center">
                <PlayerPicker players={players} hideHeadshot onGuess={onGuess} />
              </div>
              <button
                type="button"
                onClick={() => endRun(player)}
                className="block mx-auto text-sm text-red-600 hover:underline"
              >
                Give up
              </button>
            </div>
          )}
        </div>
        <div className="lg:w-72 shrink-0">
          <LeaderboardCard
            gameSlug="now-you-see-me"
            description="Top 5 best streaks (newer wins ties)"
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
