import { useMemo, useState } from 'react'
import InfoTip from './InfoTip'
import TeamNightGrid from './TeamNightGrid'
import TeamTraceButton from './TeamTraceButton'
import { METRIC_GLOSSARY } from '../constants/metricGlossary'
import type { ScheduleResponse } from '../types/api'
import {
  HIGH_VOLUME_GAMES,
  addDays,
  buildSlateWindow,
  firstScheduleDay,
  formatSlateDate,
  matchupsByDate,
} from '../utils/slateWindow'

const BAR_AREA_PX = 110
const PRESETS = [7, 14, 28] as const

interface SlateCalendarProps {
  schedule: ScheduleResponse
}

export default function SlateCalendar({ schedule }: SlateCalendarProps) {
  const calendarDays = schedule.calendar_days
  const startDate = useMemo(() => firstScheduleDay(calendarDays), [calendarDays])
  const lastDate = calendarDays[calendarDays.length - 1]?.date ?? startDate

  const clampEnd = (date: string) => (date > lastDate ? lastDate : date)
  const [endDate, setEndDate] = useState(() => clampEnd(addDays(firstScheduleDay(calendarDays), 13)))
  const [selectedDayIndex, setSelectedDayIndex] = useState(0)
  const [tracedTeam, setTracedTeam] = useState<string | null>(null)

  const matchups = useMemo(() => matchupsByDate(schedule), [schedule])
  const window = useMemo(
    () => buildSlateWindow(schedule, startDate, endDate, matchups),
    [endDate, matchups, schedule, startDate]
  )

  const { days, rows } = window
  if (!days.length) return null

  const dayIndex = Math.min(selectedDayIndex, days.length - 1)
  const selectedDay = days[dayIndex]
  const maxSlate = Math.max(...days.map(day => day.slateSize), 1)
  const tracedNights = tracedTeam
    ? days.filter(day => day.matchups.some(m => m.away === tracedTeam || m.home === tracedTeam)).length
    : 0

  const applyPreset = (nights: number | 'rest') => {
    setEndDate(nights === 'rest' ? lastDate : clampEnd(addDays(startDate, nights - 1)))
    setSelectedDayIndex(0)
  }

  const toggleTeam = (abbreviation: string) =>
    setTracedTeam(current => (current === abbreviation ? null : abbreviation))

  const activePreset = PRESETS.find(nights => clampEnd(addDays(startDate, nights - 1)) === endDate)
  const isRest = endDate === lastDate

  return (
    <div className="mb-6 space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 p-1 text-xs">
            {PRESETS.map(nights => (
              <button
                key={nights}
                type="button"
                onClick={() => applyPreset(nights)}
                className={`rounded-md px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                  activePreset === nights && !isRest ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {nights} days
              </button>
            ))}
            <button
              type="button"
              onClick={() => applyPreset('rest')}
              className={`rounded-md px-2.5 py-1.5 sm:px-3 sm:py-2 ${
                isRest ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              Rest of season
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-lg bg-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-600">
            through
            <input
              type="date"
              value={endDate}
              min={addDays(startDate, 1)}
              max={lastDate}
              onChange={event => {
                if (!event.target.value) return
                setEndDate(clampEnd(event.target.value))
                setSelectedDayIndex(0)
              }}
              className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-xs font-bold text-gray-900"
            />
          </label>
        </div>

        {tracedTeam && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-blue-700 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800">
            <span>
              Tracing <span className="font-extrabold">{tracedTeam}</span> — {tracedNights} game{tracedNights === 1 ? '' : 's'} in
              this window, highlighted below
            </span>
            <button
              type="button"
              onClick={() => setTracedTeam(null)}
              className="ml-auto rounded-md bg-white px-2 py-1 text-[11px] font-bold text-blue-700 hover:underline"
            >
              Clear
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="inline-flex items-center gap-1 text-lg font-bold text-gray-900 sm:text-xl">
            Games per night
            <InfoTip title={METRIC_GLOSSARY.slateSize.title} body={METRIC_GLOSSARY.slateSize.body} />
          </h2>
          <span className="text-xs text-gray-500">
            {window.totalGames} games over {days.length} nights · {window.highVolumeNights} at {HIGH_VOLUME_GAMES}+
            {window.darkNights > 0 && ` · ${window.darkNights} with no games`}
          </span>
        </div>

        <div className="relative mt-3">
          <div className="flex gap-[3px] overflow-x-auto pb-1">
            {days.map((day, index) => {
              const playing = tracedTeam
                ? day.matchups.some(m => m.away === tracedTeam || m.home === tracedTeam)
                : null
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => setSelectedDayIndex(index)}
                  aria-pressed={index === dayIndex}
                  title={`${formatSlateDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })} — ${day.slateSize} game${day.slateSize === 1 ? '' : 's'}`}
                  className="min-w-[34px] flex-1 shrink-0 text-center sm:min-w-[42px]"
                >
                  <span
                    className={`flex flex-col justify-end rounded p-0.5 ${index === dayIndex ? 'bg-blue-100 ring-1 ring-inset ring-blue-700' : ''}`}
                    style={{ height: `${BAR_AREA_PX}px` }}
                  >
                    <span
                      className={`rounded-t ${day.slateSize >= HIGH_VOLUME_GAMES ? 'bg-blue-900 dark:bg-blue-300' : 'bg-blue-600'} ${
                        playing === false ? 'opacity-20' : ''
                      } ${playing === true ? 'ring-2 ring-inset ring-gray-900 dark:ring-gray-100' : ''}`}
                      style={{ height: `${(day.slateSize / maxSlate) * 100}%` }}
                    />
                    {day.slateSize === 0 && <span className="mx-auto w-1/2 border-t-2 border-dotted border-gray-400" />}
                  </span>
                  <span
                    className={`mt-1 block text-xs font-bold tabular-nums ${
                      day.slateSize === 0 ? 'text-gray-400' : day.slateSize >= HIGH_VOLUME_GAMES ? 'text-blue-900' : 'text-gray-800'
                    }`}
                  >
                    {day.slateSize}
                  </span>
                  <span className={`block text-[9px] leading-tight ${index === dayIndex ? 'font-bold text-blue-700' : 'text-gray-400'}`}>
                    {formatSlateDate(day.date, { weekday: 'short' })}
                    <br />
                    {formatSlateDate(day.date, { month: 'numeric', day: 'numeric' })}
                  </span>
                </button>
              )
            })}
          </div>
          {maxSlate >= HIGH_VOLUME_GAMES && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-500"
              style={{ top: `${2 + (BAR_AREA_PX - 4) * (1 - HIGH_VOLUME_GAMES / maxSlate)}px` }}
            >
              <span className="absolute right-0 -top-4 bg-white px-1 text-[9px] font-bold text-slate-500">
                {HIGH_VOLUME_GAMES} games
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500">
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-600 align-[-2px]" />games that night</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-900 align-[-2px] dark:bg-blue-300" />high-volume night ({HIGH_VOLUME_GAMES}+)</span>
          <span><span className="mr-1 inline-block w-3 border-t border-dashed border-slate-500 align-[3px]" />the {HIGH_VOLUME_GAMES}-game line</span>
          <span><span className="mr-1 inline-block w-3 border-t-2 border-dotted border-gray-400 align-[3px]" />no games</span>
        </div>

        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-gray-900">
              {formatSlateDate(selectedDay.date, { weekday: 'long', month: 'short', day: 'numeric' })}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                selectedDay.slateSize >= HIGH_VOLUME_GAMES ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {selectedDay.slateSize === 0 ? 'no games' : `${selectedDay.slateSize} games`}
              {selectedDay.slateSize >= HIGH_VOLUME_GAMES && ' · high volume'}
            </span>
            <span className="text-xs text-gray-500">
              {selectedDay.slateSize === 0
                ? 'every team is off'
                : `${selectedDay.slateSize * 2} of 30 teams active · tap any team to trace it`}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {selectedDay.matchups.map(matchup => (
              <span
                key={`${matchup.away}-${matchup.home}`}
                className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-1.5 py-1"
              >
                <TeamTraceButton abbreviation={matchup.away} traced={matchup.away === tracedTeam} onToggle={toggleTeam} />
                <span className="text-[10px] font-bold text-gray-400">@</span>
                <TeamTraceButton abbreviation={matchup.home} traced={matchup.home === tracedTeam} onToggle={toggleTeam} />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 shadow sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold text-gray-900 sm:text-xl">Who plays when</h2>
          <span className="text-xs text-gray-500">
            tap a team to trace it · tap a column header to sort
            {days.length > 21 && ' · scroll sideways for the rest of the window'}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Teams play {window.minGames}–{window.maxGames} games in this window · {window.ordinaryTeams} of {rows.length} at{' '}
          {window.modalGames}
        </p>
        <div className="mt-3">
          <TeamNightGrid
            days={days}
            rows={rows}
            selectedDayIndex={dayIndex}
            tracedTeam={tracedTeam}
            onSelectDay={setSelectedDayIndex}
            onToggleTeam={toggleTeam}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500">
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-blue-600 align-[-2px]" />plays</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-amber-500 align-[-2px]" />second night of a back-to-back</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm bg-gray-200 align-[-2px] dark:bg-gray-600" />off</span>
          <span><span className="mr-1 inline-block h-3 w-3 rounded-sm border border-gray-300 align-[-2px]" />league-wide dark night</span>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          <b className="text-gray-600">G</b> = games in the window. <b className="text-gray-600">Δ</b> = whole games above or
          below the count most teams have; <b className="text-gray-600">—</b> means ordinary.{' '}
          <b className="text-gray-600">B2B</b> = back-to-backs inside the window.{' '}
          <b className="text-gray-600">Next</b> = first game from today.
        </p>
      </div>
    </div>
  )
}
