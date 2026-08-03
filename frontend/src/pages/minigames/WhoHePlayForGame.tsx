import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import TeamPicker from '../../components/minigames/TeamPicker'
import TimerBar from '../../components/minigames/TimerBar'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import { useMinigamePlayers } from '../../minigames/useMinigamePlayers'
import { buildNbaTeamOptions, pickRandomPlayer } from '../../minigames/players'
import { createStreakState, onRoundLoss, onRoundWin } from '../../minigames/streak'
import { useRunEnd } from '../../minigames/useRunEnd'
import { WHO_HE_ROUND_SECONDS, type MinigamePlayer, type NbaTeamOption } from '../../minigames/types'

export default function WhoHePlayForGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('who-he-play-for')
  const teams = useMemo(() => buildNbaTeamOptions(players), [players])

  const [phase, setPhase] = useState<'lobby' | 'playing'>('lobby')
  const [player, setPlayer] = useState<MinigamePlayer | null>(null)
  const [timerKey, setTimerKey] = useState(0)
  const [streak, setStreak] = useState(createStreakState())
  const [reveal, setReveal] = useState<string | null>(null)

  const startRound = useCallback(
    (excludeId?: string) => {
      if (!players.length) return
      setPlayer(pickRandomPlayer(players, excludeId))
      setTimerKey((k) => k + 1)
      setReveal(null)
      setPhase('playing')
    },
    [players],
  )

  const startNewGame = () => {
    runEnd.clearFinal()
    setStreak(createStreakState())
    startRound()
  }

  const endRun = useCallback(
    (answerTeam?: string, s = streak) => {
      setReveal(answerTeam ?? player?.team ?? null)
      setPhase('lobby')
      void runEnd.handleRunEnd({ bestStreak: s.bestStreak })
      setStreak(onRoundLoss(s))
    },
    [player?.team, runEnd, streak],
  )

  const onPick = (team: NbaTeamOption) => {
    if (phase !== 'playing' || !player) return
    if (team.abbr === player.teamAbbr) {
      const next = onRoundWin(streak)
      setStreak(next)
      startRound(player.id)
    } else {
      endRun(player.team)
    }
  }

  if (isLoading) return <LoadingSpinner />
  if (error || !players.length) return <ErrorMessage message="Failed to load players" />

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
              {runEnd.finalScore != null && (
                <p className="mb-2 text-lg">
                  Run over — best streak: <strong>{runEnd.finalScore}</strong>
                </p>
              )}
              {reveal && (
                <p className="mb-4 text-sm text-gray-600 dark:text-gray-300">
                  Correct team: <strong>{reveal}</strong>
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

          {phase === 'playing' && player && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-6 bg-white dark:bg-gray-900 space-y-4">
              <TimerBar
                totalSeconds={WHO_HE_ROUND_SECONDS}
                running
                resetKey={timerKey}
                onTimeout={() => endRun(player.team)}
              />
              <p className="text-3xl font-bold text-center text-gray-900 dark:text-gray-100 py-6">
                {player.displayName}
              </p>
              <TeamPicker teams={teams} onPick={onPick} />
              <button
                type="button"
                onClick={() => endRun(player.team)}
                className="block mx-auto text-sm text-red-600 hover:underline"
              >
                Give up
              </button>
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
