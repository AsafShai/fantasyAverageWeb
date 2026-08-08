import { useCallback, useState } from 'react'
import {
  useCheckMinigameQualifyMutation,
  useSubmitMinigameLeaderboardMutation,
  useGetMinigameLeaderboardQuery,
} from '../store/api/fantasyApi'
import type { GameSlug } from './types'
import { HINTS_GAMES } from './types'

type EndPayload = {
  bestStreak: number
  hintsUsed?: number | null
}

/** Handles end-of-run qualify → name modal → submit → refresh leaderboard. */
export function useRunEnd(gameSlug: GameSlug) {
  const { refetch } = useGetMinigameLeaderboardQuery(gameSlug)
  const [checkQualify] = useCheckMinigameQualifyMutation()
  const [submitScore, { isLoading: submitting }] = useSubmitMinigameLeaderboardMutation()

  const [showNameModal, setShowNameModal] = useState(false)
  const [pending, setPending] = useState<EndPayload | null>(null)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const usesHints = HINTS_GAMES.includes(gameSlug)

  const handleRunEnd = useCallback(
    async (payload: EndPayload) => {
      setFinalScore(payload.bestStreak)
      setSubmitError(null)
      if (payload.bestStreak <= 0) {
        setShowNameModal(false)
        setPending(null)
        return
      }
      try {
        const body: { bestStreak: number; hintsUsed?: number } = {
          bestStreak: payload.bestStreak,
        }
        if (usesHints) body.hintsUsed = payload.hintsUsed ?? 0
        const res = await checkQualify({ gameSlug, ...body }).unwrap()
        if (res.qualifies) {
          setPending(payload)
          setShowNameModal(true)
        } else {
          setPending(null)
          setShowNameModal(false)
        }
      } catch {
        setPending(null)
        setShowNameModal(false)
      }
    },
    [checkQualify, gameSlug, usesHints],
  )

  const submitName = useCallback(
    async (displayName: string) => {
      if (!pending) return
      setSubmitError(null)
      try {
        const body: { displayName: string; bestStreak: number; hintsUsed?: number } = {
          displayName,
          bestStreak: pending.bestStreak,
        }
        if (usesHints) body.hintsUsed = pending.hintsUsed ?? 0
        await submitScore({ gameSlug, ...body }).unwrap()
        setShowNameModal(false)
        setPending(null)
        await refetch()
      } catch (e: unknown) {
        const detail =
          e && typeof e === 'object' && 'data' in e
            ? String((e as { data?: { detail?: string } }).data?.detail ?? 'Submit failed')
            : 'Submit failed'
        setSubmitError(detail)
      }
    },
    [gameSlug, pending, refetch, submitScore, usesHints],
  )

  const dismissModal = useCallback(() => {
    setShowNameModal(false)
    setPending(null)
  }, [])

  const clearFinal = useCallback(() => {
    setFinalScore(null)
    setShowNameModal(false)
    setPending(null)
    setSubmitError(null)
  }, [])

  return {
    handleRunEnd,
    showNameModal,
    submitName,
    dismissModal,
    submitting,
    submitError,
    finalScore,
    clearFinal,
    pendingScore: pending?.bestStreak ?? null,
  }
}
