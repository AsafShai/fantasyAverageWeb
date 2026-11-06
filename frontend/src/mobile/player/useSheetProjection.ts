import { useEffect, useRef, useState } from 'react'
import { FF_PAST_SLATES } from '../../config/featureFlags'
import { useGetPlayerNextGameProjectionQuery, usePredictProjectionMutation } from '../../store/api/fantasyApi'
import type { PlayerNextGameProjection, ProjectionStats } from '../../types/api'

export interface SheetProjection {
  data: PlayerNextGameProjection
  minutes: number
  defaultMinutes: number
  stats: ProjectionStats
  setMinutes: (minutes: number) => void
}

/**
 * Next-game projection for the player sheet, with the same rules as the
 * profile's PlayerNextGameCard: no line (unknown player, too little history,
 * no game) means no block; the unscheduled fallback is a debug view behind
 * FF_PAST_SLATES. Changing minutes re-asks the model (POST /projections/predict),
 * debounced like the profile's slider; going back to the default minutes
 * shows the original line again.
 */
export function useSheetProjection(playerId: string | null): { loading: boolean; projection: SheetProjection | null } {
  const { data, isLoading, isError } = useGetPlayerNextGameProjectionQuery(playerId ?? '', { skip: !playerId })
  const [predict] = usePredictProjectionMutation()
  const [minutes, setMinutesState] = useState(0)
  const [stats, setStats] = useState<ProjectionStats | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Keyed on stable primitives, not the response object: a background
  // refetch must not wipe adjusted minutes.
  const defaultMinutes = Math.round(data?.default_minutes ?? 0)
  const slateKey = `${playerId}|${data?.opponent ?? null}|${defaultMinutes}`
  const [syncedKey, setSyncedKey] = useState<string | null>(null)
  if (slateKey !== syncedKey) {
    setSyncedKey(slateKey)
    setMinutesState(defaultMinutes)
    setStats(data?.stats ?? null)
  }
  useEffect(() => () => clearTimeout(timer.current), [slateKey])

  if (!playerId || isLoading) return { loading: !!playerId, projection: null }
  const hasLine = !!data?.opponent && data.status !== 'red' && !!data.stats
  if (isError || !data || !hasLine) return { loading: false, projection: null }
  if (!data.scheduled && !FF_PAST_SLATES) return { loading: false, projection: null }

  const setMinutes = (v: number) => {
    setMinutesState(v)
    clearTimeout(timer.current)
    if (v === defaultMinutes) {
      setStats(data.stats)
      return
    }
    timer.current = setTimeout(async () => {
      try {
        const res = await predict({
          player_name: data.player_name,
          opponent: data.opponent as string,
          is_home: data.is_home,
          minutes: v,
        }).unwrap()
        setStats(res.stats)
      } catch {
        /* keep the last line on a transient predict error */
      }
    }, 350)
  }

  return {
    loading: false,
    projection: { data, minutes, defaultMinutes, stats: stats ?? data.stats!, setMinutes },
  }
}
