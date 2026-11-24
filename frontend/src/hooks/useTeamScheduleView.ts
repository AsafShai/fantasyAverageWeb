import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useGetTeamResultsQuery } from '../store/api/fantasyApi'
import type { ScheduleTeam } from '../types/api'
import { initialScrollTarget, rowsForView, scheduleRows, seasonRecord, type ScheduleView } from '../utils/teamSchedule'

const VIEW_KEY = 'fw:team-schedule-view'
const VIEWS: ScheduleView[] = ['results', 'upcoming', 'all']

function readView(): ScheduleView {
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    return VIEWS.includes(saved as ScheduleView) ? (saved as ScheduleView) : 'upcoming'
  } catch {
    return 'upcoming'
  }
}

/**
 * State for a team's schedule: which view (Results / Upcoming / All, remembered
 * per browser), the rows it shows with final scores joined in, the counts, and
 * a ref for the scroll box so each view opens where it is useful.
 * Returns `[schedule, scrollRef]`.
 */
export function useTeamScheduleView(team: ScheduleTeam) {
  const { data: results, isError: resultsFailed } = useGetTeamResultsQuery(String(team.team_id))
  const [view, setViewState] = useState<ScheduleView>(readView)
  const scrollRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => scheduleRows(team, Array.isArray(results) ? results : []), [team, results])
  const shown = useMemo(() => rowsForView(rows, view), [rows, view])
  const firstUpcoming = shown.findIndex(row => !row.played)
  const todayIndex = firstUpcoming === -1 ? shown.length : firstUpcoming
  const remaining = rows.filter(row => !row.played)
  const record = seasonRecord(Array.isArray(results) ? results : [])
  const resultsReady = results !== undefined

  const setView = (next: ScheduleView) => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // storage blocked: the view just isn't remembered
    }
  }

  // Open each view where it is useful: Results at the latest game, All on
  // today's line with a few results above it, Upcoming at the next game.
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const target = initialScrollTarget(view, shown.length, todayIndex)
    if (target === 'top') box.scrollTop = 0
    else if (target === 'bottom') box.scrollTop = box.scrollHeight
    else {
      const row = box.querySelector<HTMLElement>(`[data-row-index="${target}"]`)
      if (!row) return
      const head = box.querySelector('thead')?.getBoundingClientRect().height ?? 0
      box.scrollTop += row.getBoundingClientRect().top - box.getBoundingClientRect().top - head
    }
    // Re-aim when the view or team changes, or once the scores arrive — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, team.team_id, resultsReady])

  const schedule = {
    view,
    setView,
    shown,
    todayIndex,
    resultsFailed,
    record: resultsReady ? record : null,
    counts: { results: rows.length - remaining.length, upcoming: remaining.length, all: rows.length },
    played: rows.length - remaining.length,
    left: remaining.length,
    b2bLeft: remaining.filter(row => row.game.rest_days === 0).length,
    highVolumeLeft: remaining.filter(row => row.game.high_volume).length,
  }
  // The ref goes back on its own so reading the schedule during render never touches it.
  return [schedule, scrollRef] as const
}
