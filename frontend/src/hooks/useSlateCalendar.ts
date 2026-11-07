import { useMemo, useState } from 'react'
import type { ScheduleResponse } from '../types/api'
import { addDays, buildSlateWindow, firstScheduleDay, matchupsByDate } from '../utils/slateWindow'

export const SLATE_PRESETS = [7, 14, 28] as const
export type SlateWindowMode = (typeof SLATE_PRESETS)[number] | 'custom'

/**
 * Season Schedule window state (7/14/28 days or a picked end date), the
 * selected night and the traced team. Shared by the desktop and phone layouts.
 */
export function useSlateCalendar(schedule: ScheduleResponse) {
  const calendarDays = schedule.calendar_days
  const startDate = useMemo(() => firstScheduleDay(calendarDays), [calendarDays])
  const lastDate = calendarDays[calendarDays.length - 1]?.date ?? startDate

  const clampEnd = (date: string) => (date > lastDate ? lastDate : date)
  // Mode is explicit rather than inferred from the end date. Inferring it made
  // a hand-picked date that happened to match a preset flip the active button,
  // and left no way to say "the user is choosing their own end date".
  const [mode, setMode] = useState<SlateWindowMode>(14)
  const [customEnd, setCustomEnd] = useState(lastDate)
  const [draftEnd, setDraftEnd] = useState<string | null>(null)
  const [selectedDayIndex, setSelectedDayIndex] = useState(0)
  const [tracedTeam, setTracedTeam] = useState<string | null>(null)

  const endDate = mode === 'custom' ? customEnd : clampEnd(addDays(startDate, mode - 1))
  const minEnd = addDays(startDate, 1)

  const matchups = useMemo(() => matchupsByDate(schedule), [schedule])
  const window = useMemo(
    () => buildSlateWindow(schedule, startDate, endDate, matchups),
    [endDate, matchups, schedule, startDate]
  )

  const { days, rows } = window
  const dayIndex = Math.min(selectedDayIndex, Math.max(days.length - 1, 0))
  const selectedDay = days[dayIndex]
  const maxSlate = Math.max(...days.map(day => day.slateSize), 1)
  const tracedNights = tracedTeam
    ? days.filter(day => day.matchups.some(m => m.away === tracedTeam || m.home === tracedTeam)).length
    : 0

  const chooseMode = (next: SlateWindowMode) => {
    if (next === 'custom') setCustomEnd(lastDate)
    setMode(next)
    setDraftEnd(null)
    setSelectedDayIndex(0)
  }

  /** Draft state lets the field hold a half-typed date. */
  const typeEnd = (picked: string) => {
    setDraftEnd(picked)
    if (!picked || picked < minEnd || picked > lastDate) return
    setCustomEnd(picked)
    setSelectedDayIndex(0)
  }

  const toggleTeam = (abbreviation: string) =>
    setTracedTeam(current => (current === abbreviation ? null : abbreviation))

  return {
    mode, chooseMode, endDate, draftEnd, typeEnd, clearDraft: () => setDraftEnd(null), minEnd, lastDate,
    window, days, rows, dayIndex, selectedDay, setSelectedDayIndex, maxSlate,
    tracedTeam, clearTrace: () => setTracedTeam(null), toggleTeam, tracedNights,
  }
}
