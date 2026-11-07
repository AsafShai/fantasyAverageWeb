import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import MinigameAnswerReveal from '../../components/minigames/MinigameAnswerReveal'
import MinigameRunOverSummary from '../../components/minigames/MinigameRunOverSummary'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import RoundSuccessIndicator from '../../components/minigames/RoundSuccessIndicator'
import TeamPicker from '../../components/minigames/TeamPicker'
import TimerBar from '../../components/minigames/TimerBar'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { getErrorMessage } from '../../utils/errorMessage'
import { useMinigamePlayers } from '../../minigames/useMinigamePlayers'
import { buildNbaTeamOptions, pickRandomPlayer } from '../../minigames/players'
import { createStreakState, onRoundLoss, onRoundWin } from '../../minigames/streak'
import { useRunEnd } from '../../minigames/useRunEnd'
import { WHO_HE_ROUND_SECONDS, type MinigamePlayer, type NbaTeamOption } from '../../minigames/types'
import { useMobileRedesign } from '../../mobile/flag'
import MinigamePageMobile from '../../mobile/minigames/MinigamePageMobile'

export default function WhoHePlayForGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('who-he-play-for')
  const mobile = useMobileRedesign()
  const teams = useMemo(() => buildNbaTeamOptions(players), [players])

  const [phase, setPhase] = useState<'lobby' | 'playing'>('lobby')
  const [player, setPlayer] = useState<MinigamePlayer | null>(null)
  const [timerKey, setTimerKey] = useState(0)
  const [streak, setStreak] = useState(createStreakState())
  const [runReveal, setRunReveal] = useState<MinigamePlayer | null>(null)
  const [roundOk, setRoundOk] = useState(false)

  const startRound = useCallback(
    (excludeId?: string) => {
      if (!players.length) return
      setPlayer(pickRandomPlayer(players, excludeId))
      setTimerKey((k) => k + 1)
      setRoundOk(false)
      setPhase('playing')
    },
    [players],
  )

  const startNewGame = () => {
    runEnd.clearFinal()
    setRunReveal(null)
    setStreak(createStreakState())
    startRound()
  }

  const endRun = useCallback(
    (answer: MinigamePlayer | null = player, s = streak) => {
      setRunReveal(answer ?? player)
      setPhase('lobby')
      void runEnd.handleRunEnd({ bestStreak: s.bestStreak })
      setStreak(onRoundLoss(s))
    },
    [player, runEnd, streak],
  )

  const onPick = (team: NbaTeamOption) => {
    if (phase !== 'playing' || !player || roundOk) return
    if (team.abbr === player.teamAbbr) {
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

  const board = player && (
    <>
      <TimerBar
        totalSeconds={WHO_HE_ROUND_SECONDS}
        running={!roundOk}
        resetKey={timerKey}
        onTimeout={() => endRun(player)}
        prominent={mobile}
      />
      {roundOk && (
        <div className="flex justify-center py-1">
          <RoundSuccessIndicator />
        </div>
      )}
      <p className="text-3xl font-bold text-center text-gray-900 dark:text-gray-100 py-6">
        {player.displayName}
      </p>
      <button
        type="button"
        onClick={() => endRun(player)}
        disabled={roundOk}
        className="relative z-30 block mx-auto text-sm text-red-600 hover:underline disabled:opacity-40"
      >
        Give up
      </button>
      <TeamPicker teams={teams} disabled={roundOk} onPick={onPick} />
    </>
  )
  const runOver = (
    <>
      <MinigameRunOverSummary bestStreak={runEnd.finalScore} />
      {runReveal ? (
        <MinigameAnswerReveal player={runReveal} detail={`Team: ${runReveal.team}`} />
      ) : null}
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
        slug="who-he-play-for"
        title="Who He Play For?"
        subtitle={`Pick the team — ${WHO_HE_ROUND_SECONDS}s per round`}
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
            Who He Play For?
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Pick the team — {WHO_HE_ROUND_SECONDS}s per round
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
            gameSlug="who-he-play-for"
            description="Top 5 best streaks (newer wins ties)"
          />
        </div>
      </div>
      {nameModal}
    </div>
  )
}
