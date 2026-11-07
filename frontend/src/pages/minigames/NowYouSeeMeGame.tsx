import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import MinigameAnswerReveal from '../../components/minigames/MinigameAnswerReveal'
import MinigameRunOverSummary from '../../components/minigames/MinigameRunOverSummary'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import PlayerPicker from '../../components/minigames/PlayerPicker'
import RoundSuccessIndicator from '../../components/minigames/RoundSuccessIndicator'
import TimerBar from '../../components/minigames/TimerBar'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { getErrorMessage } from '../../utils/errorMessage'
import { useMinigamePlayers } from '../../minigames/useMinigamePlayers'
import { pickRandomPlayerWithPhoto, playersWithPhotos } from '../../minigames/players'
import { createStreakState, onRoundLoss, onRoundWin } from '../../minigames/streak'
import { useRunEnd } from '../../minigames/useRunEnd'
import { NOW_YOU_SEE_ME_ROUND_SECONDS, type MinigamePlayer } from '../../minigames/types'
import { useMobileRedesign } from '../../mobile/flag'
import MinigamePageMobile from '../../mobile/minigames/MinigamePageMobile'

export default function NowYouSeeMeGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('now-you-see-me')
  const mobile = useMobileRedesign()
  const photoPlayers = playersWithPhotos(players)

  const [phase, setPhase] = useState<'lobby' | 'playing'>('lobby')
  const [player, setPlayer] = useState<MinigamePlayer | null>(null)
  const [timerKey, setTimerKey] = useState(0)
  const [streak, setStreak] = useState(createStreakState())
  const [reveal, setReveal] = useState<MinigamePlayer | null>(null)
  const [roundOk, setRoundOk] = useState(false)

  const startRound = useCallback(
    (excludeId?: string) => {
      if (!photoPlayers.length) return
      setPlayer(pickRandomPlayerWithPhoto(photoPlayers, excludeId))
      setTimerKey((k) => k + 1)
      setReveal(null)
      setRoundOk(false)
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
    if (phase !== 'playing' || !player || roundOk) return
    if (guess.id === player.id) {
      const next = onRoundWin(streak)
      setStreak(next)
      setRoundOk(true)
      const id = player.id
      window.setTimeout(() => {
        setRoundOk(false)
        startRound(id)
      }, 650)
    } else {
      endRun(player)
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error || !players.length) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players')} />
  if (!photoPlayers.length) return <ErrorMessage message="No players with photos available" />

  const board = player && (
    <>
      <div className={mobile ? 'mg-timer-sticky -mx-1 px-1 pb-2 bg-white dark:bg-gray-900' : ''}>
        <TimerBar
          totalSeconds={NOW_YOU_SEE_ME_ROUND_SECONDS}
          running={!roundOk}
          resetKey={timerKey}
          onTimeout={() => endRun(player)}
          prominent
        />
      </div>
      {roundOk && (
        <div className="flex justify-center py-1">
          <RoundSuccessIndicator />
        </div>
      )}
      <div className="flex justify-center py-4">
        <img
          src={player.photoUrl!}
          alt="Mystery player"
          className="w-40 h-40 sm:w-52 sm:h-52 rounded-full object-cover object-top border-4 border-gray-200 dark:border-gray-700"
        />
      </div>
      <button
        type="button"
        onClick={() => endRun(player)}
        disabled={roundOk}
        className="block mx-auto text-sm text-red-600 hover:underline disabled:opacity-40"
      >
        Give up
      </button>
      <div className="flex justify-center w-full">
        <PlayerPicker players={players} hideHeadshot disabled={roundOk} onGuess={onGuess} />
      </div>
    </>
  )
  const runOver = (
    <>
      <MinigameRunOverSummary bestStreak={runEnd.finalScore} />
      {reveal ? <MinigameAnswerReveal player={reveal} /> : null}
    </>
  )
  const nameModal = (
    <NameEntryModal
      open={runEnd.showNameModal}
      bestStreak={runEnd.pendingScore ?? 0}
      submitting={runEnd.submitting}
      error={runEnd.submitError}
      onSubmit={runEnd.submitName}
      onDismiss={runEnd.dismissModal}
    />
  )

  if (mobile) {
    return (
      <MinigamePageMobile
        slug="now-you-see-me"
        title="Now You See Me"
        subtitle={`Name the player from their photo — ${NOW_YOU_SEE_ME_ROUND_SECONDS}s`}
        stats={[
          { label: 'Streak', value: streak.currentStreak },
          { label: 'Best', value: streak.bestStreak },
        ]}
        lobby={phase === 'lobby' || !player}
        runOver={runOver}
        onStart={startNewGame}
        board={board}
        leaderboardDescription="Top 5 best streaks (newer wins ties)"
      >
        {nameModal}
      </MinigamePageMobile>
    )
  }

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
              {runOver}
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
              {board}
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
      {nameModal}
    </div>
  )
}
