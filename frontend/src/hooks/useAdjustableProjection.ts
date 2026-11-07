import { useEffect, useRef, useState } from 'react'
import { usePredictProjectionMutation } from '../store/api/fantasyApi'
import type { PlayerMatchup, ProjectionStats } from '../types/api'

/**
 * One Projections row: the model's minutes and stat line, with a minutes
 * control that re-predicts (POST /projections/predict, debounced) and a reset
 * back to the model's default. Shared by the desktop table row and the phone
 * card.
 *
 * `resetKey` lets the page reset every row at once (phone "Reset to default
 * minutes"): a new value puts the row back on the model's numbers.
 */
export function useAdjustableProjection(matchup: PlayerMatchup, resetKey: number | string = 0) {
  const proj = matchup.projection
  const [predict] = usePredictProjectionMutation()
  const [minutes, setMinutesState] = useState(proj?.default_minutes ?? 0)
  const [stats, setStats] = useState<ProjectionStats | null>(proj?.stats ?? null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Re-sync when the underlying slate changes (opponent switches) or the
  // store recomputes a new default (nightly fold-in) — React reuses row
  // components by key, so stale local minutes/stats would otherwise survive
  // and show the previous slate's numbers. Keyed on stable primitives, not
  // the `proj` object identity, so a same-slate refetch (e.g. RTK Query
  // background revalidation) can't silently wipe an adjusted slider.
  const slateKey = `${matchup.opponent}|${proj?.default_minutes}|${resetKey}`
  const [syncedSlateKey, setSyncedSlateKey] = useState(slateKey)
  if (slateKey !== syncedSlateKey) {
    setSyncedSlateKey(slateKey)
    setMinutesState(proj?.default_minutes ?? 0)
    setStats(proj?.stats ?? null)
  }
  // A slider re-predict still pending from the previous slate must not land on this one.
  useEffect(() => () => clearTimeout(timer.current), [slateKey])

  const setMinutes = (v: number) => {
    setMinutesState(v)
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const res = await predict({
          player_name: matchup.player_name, opponent: matchup.opponent,
          is_home: matchup.is_home, minutes: v,
        }).unwrap()
        setStats(res.stats)
      } catch { /* ignore transient predict errors */ }
    }, 350)
  }

  // Restore default minutes + the original default-t stats (no network round
  // trip; also cancels any pending re-predict so it can't overwrite them).
  const resetToDefault = () => {
    clearTimeout(timer.current)
    setMinutesState(proj?.default_minutes ?? 0)
    setStats(proj?.stats ?? null)
  }
  const defaultMinutes = proj?.default_minutes ?? 0
  const isAdjusted = Math.round(minutes) !== Math.round(defaultMinutes)

  return { proj, minutes, stats, setMinutes, resetToDefault, defaultMinutes, isAdjusted }
}

export function fmtProjStat(n: number, integer: boolean): string {
  return integer ? String(Math.round(n)) : n.toFixed(1)
}

/** Shooting % with its makes / attempts, rounded like the rest of the line. */
export function projPctParts(pctVal: number, made: number, att: number, integer: boolean) {
  if (!(att > 0)) return { pct: '—', m: '', a: '', ok: false }
  if (integer) {
    const m = Math.round(made), a = Math.round(att)
    return { pct: a > 0 ? `${Math.round((m / a) * 100)}%` : '—', m: String(m), a: String(a), ok: a > 0 }
  }
  return { pct: `${(pctVal * 100).toFixed(1)}%`, m: made.toFixed(1), a: att.toFixed(1), ok: true }
}
