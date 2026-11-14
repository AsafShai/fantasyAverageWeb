import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import LeaderboardCard from '../../components/minigames/LeaderboardCard'
import MinigameAnswerReveal from '../../components/minigames/MinigameAnswerReveal'
import MinigameRunOverSummary from '../../components/minigames/MinigameRunOverSummary'
import AutoNextToggle from '../../components/minigames/AutoNextToggle'
import WhoAmIMobileToolbar from '../../components/minigames/WhoAmIMobileToolbar'
import NameEntryModal from '../../components/minigames/NameEntryModal'
import WhoAmIFeedbackLegend from '../../components/minigames/WhoAmIFeedbackLegend'
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
import { useMobileRedesign } from '../../mobile/flag'
import MinigamePageMobile from '../../mobile/minigames/MinigamePageMobile'
import { useSheetHistory } from '../../mobile/ui'

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
      <span className="inline-flex items-center justify-center gap-0.5 min-h-5">
        {label}
        {showInfo ? <NbaMapInfoButton onOpen={onOpenMap} /> : <span className="inline-block w-5" aria-hidden />}
      </span>
    </th>
  )
}

function WhoAmIMobileField({
  label,
  showInfo,
  onOpenMap,
  display,
  state,
  dir,
  compact = false,
}: {
  label: string
  showInfo: boolean
  onOpenMap: () => void
  display: string
  state: string
  dir?: 'higher' | 'lower'
  compact?: boolean
}) {
  return (
    <div
      className={`mg-whoami-field flex h-full flex-col ${compact ? 'min-h-[2.65rem]' : 'min-h-[3.5rem]'}`}
    >
      <div
        className={`flex shrink-0 items-center justify-between gap-0.5 font-medium uppercase leading-none tracking-wide text-gray-500 dark:text-gray-400 ${
          compact
            ? 'mb-0.5 h-4 text-[9px]'
            : 'mb-1 h-5 text-[10px]'
        }`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span
          className={`flex shrink-0 items-center justify-center ${compact ? 'h-4 w-4' : 'h-5 w-5'}`}
        >
          {showInfo ? <NbaMapInfoButton onOpen={onOpenMap} /> : null}
        </span>
      </div>
      <div
        className={`flex flex-1 items-center justify-center text-center leading-tight ${cellClass(state)} ${
          compact
            ? 'min-h-[1.4rem] rounded px-1 py-0.5 text-[10px]'
            : 'min-h-[2.25rem] rounded-md px-1.5 py-1 text-xs'
        }`}
      >
        <span className="break-words">
          {display}
          {dirArrow(dir)}
        </span>
      </div>
    </div>
  )
}

export default function WhoAmIGame() {
  const { players, isLoading, error } = useMinigamePlayers()
  const runEnd = useRunEnd('who-am-i')
  const mobile = useMobileRedesign()
  // On a phone the map is a bottom sheet in browser history (back closes it).
  const mapSheet = useSheetHistory('nba-map')
  const tree = useConferenceDivisionTree(players)

  const [phase, setPhase] = useState<'lobby' | 'playing' | 'won'>('lobby')
  const [secret, setSecret] = useState<MinigamePlayer | null>(null)
  const [rows, setRows] = useState<WhoAmIGuessRow[]>([])
  const [photoHint, setPhotoHint] = useState(false)
  const [streak, setStreak] = useState(createStreakState())
  const [autoMode, setAutoMode] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [lastRunHints, setLastRunHints] = useState<number | null>(null)
  const [hintNotice, setHintNotice] = useState(false)
  const mapOpen = mobile ? mapSheet.open : dialogOpen
  const setMapOpen = (v: boolean) => {
    if (!mobile) setDialogOpen(v)
    else if (v) mapSheet.show()
    else mapSheet.hide()
  }

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
    setLastRunHints(null)
    setHintNotice(false)
    setStreak(createStreakState())
    startRound()
  }

  const endRun = useCallback(
    (s = streak) => {
      setLastRunHints(s.minHintsForBestTie ?? s.runHintsUsed)
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

  // Auto mode: a win starts a 3-second countdown to the next round. The start
  // value is set during render when the countdown begins; the effect ticks it.
  const autoAdvancing = phase === 'won' && autoMode
  const [wasAutoAdvancing, setWasAutoAdvancing] = useState(autoAdvancing)
  if (autoAdvancing !== wasAutoAdvancing) {
    setWasAutoAdvancing(autoAdvancing)
    if (autoAdvancing) setCountdown(3)
  }

  useEffect(() => {
    if (!autoAdvancing) return
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
  }, [autoAdvancing, goNext])

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
    setHintNotice(true)
  }

  if (isLoading) return <LoadingSpinner />
  if (error || !players.length) return <ErrorMessage message={getErrorMessage(error, 'Failed to load players')} />

  const inRound = phase === 'playing' || phase === 'won'
  const autoToggle = inRound ? (
    <AutoNextToggle checked={autoMode} onChange={setAutoMode} label="Auto next (3s)" />
  ) : null
  const mapButton = inRound ? (
    <button
      type="button"
      onClick={() => setMapOpen(true)}
      className={mobile ? 'mr-link' : 'text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1'}
    >
      <span aria-hidden>ⓘ</span> View map
    </button>
  ) : null

  const photoHintButton = (
    <button
      type="button"
      disabled={photoHint || phase !== 'playing'}
      onClick={usePhotoHint}
      className="px-3 py-2 text-xs rounded border border-dashed border-gray-400 disabled:opacity-40"
    >
      Photo hint
    </button>
  )
  const giveUpButton =
    phase === 'playing' ? (
      <button type="button" onClick={() => endRun()} className="text-sm text-red-600 hover:underline">
        Give up
      </button>
    ) : null

  const board = secret && (
    <>
      <WhoAmIFeedbackLegend />
      {!mobile && (
        <div className="flex flex-wrap items-center gap-3">
          {photoHintButton}
          {giveUpButton}
        </div>
      )}
      <PlayerPicker
        players={players}
        excludeIds={rows.map((r) => r.guessedPlayerId)}
        hideHeadshot={photoHint}
        disabled={phase !== 'playing'}
        onGuess={onGuess}
      />
      {hintNotice && (
        <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
          Photo hint used — counts toward your hint total for the leaderboard.
        </p>
      )}

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
      </div>

      {mobile && inRound && (
        <WhoAmIMobileToolbar
          guessCount={rows.length}
          maxGuesses={WHO_AM_I_MAX_GUESSES}
          photoHintUsed={photoHint}
          canPhotoHint={phase === 'playing'}
          onPhotoHint={usePhotoHint}
          showGiveUp={phase === 'playing'}
          onGiveUp={() => endRun()}
          autoNext={autoMode}
          onAutoNextChange={setAutoMode}
          onOpenMap={() => setMapOpen(true)}
        />
      )}

      {/* Mobile guess cards — newest first */}
      <div className="mg-whoami-guess-list sm:hidden space-y-1.5">
        {[...rows].reverse().map((row) => (
          <div
            key={row.guessedPlayerId}
            className="mg-whoami-guess-card rounded-md border border-gray-200 dark:border-gray-700 p-2"
          >
            <p className="mb-1 truncate font-semibold text-[11px] leading-tight text-gray-900 dark:text-gray-100">
              {row.guessedName}
            </p>
            <div className="grid grid-cols-2 items-stretch gap-x-1.5 gap-y-1 text-xs">
              {WHO_AM_I_COLUMNS.map((c) => {
                const cell = row.feedback[c.key]
                const showInfo = c.key === 'conference' || c.key === 'division'
                return (
                  <WhoAmIMobileField
                    key={c.key}
                    compact
                    label={c.label}
                    showInfo={showInfo}
                    onOpenMap={() => setMapOpen(true)}
                    display={row.display[c.key]}
                    state={cell.state}
                    dir={cell.dir}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {!mobile && (
        <p className="text-xs text-gray-400 text-center sm:text-left">
          Guesses: {rows.length}/{WHO_AM_I_MAX_GUESSES}
        </p>
      )}

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
    </>
  )
  const runOver = (
    <>
      <MinigameRunOverSummary bestStreak={runEnd.finalScore} hintsUsed={lastRunHints} />
      {secret && runEnd.finalScore != null ? <MinigameAnswerReveal player={secret} /> : null}
    </>
  )
  const modals = (
    <>
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
        sheet={mobile}
      />
    </>
  )

  if (mobile) {
    return (
      <MinigamePageMobile
        slug="who-am-i"
        title="Who Am I?"
        subtitle={`Poeltl-style clues — ${WHO_AM_I_MAX_GUESSES} guesses`}
        stats={[
          { label: 'Streak', value: streak.currentStreak },
          { label: 'Best', value: streak.bestStreak },
          { label: 'Hints', value: streak.runHintsUsed },
        ]}
        controls={undefined}
        lobby={phase === 'lobby' || !secret}
        runOver={runOver}
        onStart={startNewGame}
        board={board}
        leaderboardDescription="Top 5 best streaks (fewer hints wins ties)"
      >
        {modals}
      </MinigamePageMobile>
    )
  }

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
            {autoToggle}
            {mapButton}
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

          {(phase === 'playing' || phase === 'won') && secret && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 sm:p-6 bg-white dark:bg-gray-900 space-y-4">
              {board}
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
      {modals}
    </div>
  )
}
