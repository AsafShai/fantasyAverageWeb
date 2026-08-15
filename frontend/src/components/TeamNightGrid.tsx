import { useMemo, useState } from 'react'
import InfoTip from './InfoTip'
import TeamTraceButton from './TeamTraceButton'
import { METRIC_GLOSSARY } from '../constants/metricGlossary'
import { formatSlateDate, type SlateDay, type SlateTeamRow } from '../utils/slateWindow'

type SortKey = 'abbreviation' | 'games' | 'delta' | 'b2b' | 'nextIndex'

interface TeamNightGridProps {
  days: SlateDay[]
  rows: SlateTeamRow[]
  selectedDayIndex: number
  tracedTeam: string | null
  onSelectDay: (index: number) => void
  onToggleTeam: (abbreviation: string) => void
}

const STICKY = {
  team: 'sticky left-0 z-20 w-[54px] min-w-[54px] sm:w-[64px] sm:min-w-[64px]',
  games: 'sticky left-[54px] sm:left-[64px] z-20 w-[28px] min-w-[28px] sm:w-[34px] sm:min-w-[34px]',
  delta: 'sticky left-[82px] sm:left-[98px] z-20 w-[34px] min-w-[34px] sm:w-[40px] sm:min-w-[40px]',
  b2b: 'hidden sm:table-cell sm:sticky sm:left-[138px] sm:z-20 sm:w-[40px] sm:min-w-[40px]',
  next: 'hidden sm:table-cell sm:sticky sm:left-[178px] sm:z-20 sm:w-[62px] sm:min-w-[62px] sm:border-r-2 sm:border-gray-300',
}

function deltaLabel(delta: number): string {
  if (delta === 0) return '—'
  return delta > 0 ? `+${delta}` : `${delta}`
}

function deltaTone(delta: number): string {
  if (delta === 0) return 'text-gray-400'
  return delta > 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600'
}

// bg-gray-200 is not one of the shades index.css remaps for dark mode, so the
// "off" dot needs an explicit dark variant or it renders bright white.
function dotTone(playing: boolean, backToBack: boolean, darkNight: boolean): string {
  if (!playing) return darkNight ? 'border border-gray-300 bg-transparent' : 'bg-gray-200 dark:bg-gray-600'
  return backToBack ? 'bg-amber-500' : 'bg-blue-600'
}

export default function TeamNightGrid({
  days,
  rows,
  selectedDayIndex,
  tracedTeam,
  onSelectDay,
  onToggleTeam,
}: TeamNightGridProps) {
  const [sortKey, setSortKey] = useState<SortKey>('delta')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  const sorted = useMemo(() => {
    const compare: Record<SortKey, (a: SlateTeamRow, b: SlateTeamRow) => number> = {
      abbreviation: (a, b) => a.abbreviation.localeCompare(b.abbreviation),
      games: (a, b) => a.games - b.games,
      delta: (a, b) => a.delta - b.delta,
      b2b: (a, b) => a.b2b - b.b2b,
      nextIndex: (a, b) => b.nextIndex - a.nextIndex,
    }
    return [...rows].sort(
      (a, b) => compare[sortKey](a, b) * sortDir || a.abbreviation.localeCompare(b.abbreviation)
    )
  }, [rows, sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(current => (current === 1 ? -1 : 1))
      return
    }
    setSortKey(key)
    setSortDir(key === 'abbreviation' || key === 'nextIndex' ? 1 : -1)
  }

  const arrow = (key: SortKey) => (sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : '')
  const headTone = (key: SortKey) => (sortKey === key ? 'text-blue-700' : 'text-gray-500')

  const sortableHead = (key: SortKey, label: string, sticky: string, tip?: keyof typeof METRIC_GLOSSARY) => (
    <th
      scope="col"
      className={`${sticky} cursor-pointer bg-gray-50 px-1 py-2 text-center text-[9px] uppercase tracking-wide sm:text-[10px] ${headTone(key)}`}
      onClick={() => toggleSort(key)}
      aria-sort={sortKey === key ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {arrow(key)}
        {tip && <InfoTip title={METRIC_GLOSSARY[tip].title} body={METRIC_GLOSSARY[tip].body} />}
      </span>
    </th>
  )

  return (
    <div className="max-h-[470px] overflow-auto rounded-lg border border-gray-200">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-30 bg-gray-50">
          <tr>
            {sortableHead('abbreviation', 'Team', `${STICKY.team} text-left`)}
            {sortableHead('games', 'G', STICKY.games)}
            {sortableHead('delta', 'Δ', STICKY.delta, 'slateDelta')}
            {sortableHead('b2b', 'B2B', STICKY.b2b, 'slateB2B')}
            {sortableHead('nextIndex', 'Next', STICKY.next)}
            {days.map((day, index) => (
              <th
                key={day.date}
                scope="col"
                onClick={() => onSelectDay(index)}
                title={`${formatSlateDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })} — ${day.slateSize} games`}
                className={`w-[24px] min-w-[24px] cursor-pointer px-1 py-2 text-center text-[10px] font-semibold leading-tight sm:w-[28px] sm:min-w-[28px] sm:text-[11px] ${
                  index === selectedDayIndex ? 'bg-blue-100 text-blue-800' : day.slateSize === 0 ? 'bg-gray-200 text-gray-400 dark:bg-gray-700' : 'text-gray-500'
                }`}
              >
                {formatSlateDate(day.date, { weekday: 'narrow' })}
                <br />
                {formatSlateDate(day.date, { day: 'numeric' })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const traced = row.abbreviation === tracedTeam
            const dimmed = tracedTeam !== null && !traced
            const rowTone = traced ? 'bg-blue-50' : 'bg-white'
            return (
              <tr key={row.abbreviation} className={`border-b border-gray-100 last:border-0 ${dimmed ? 'opacity-60' : ''}`}>
                <th scope="row" className={`${STICKY.team} ${rowTone} px-1 py-1 text-left font-normal`}>
                  <TeamTraceButton abbreviation={row.abbreviation} traced={traced} onToggle={onToggleTeam} />
                </th>
                <td className={`${STICKY.games} ${rowTone} px-1 py-1 text-center font-bold tabular-nums text-gray-800`}>{row.games}</td>
                <td className={`${STICKY.delta} ${rowTone} px-1 py-1 text-center font-bold tabular-nums ${deltaTone(row.delta)}`}>
                  {deltaLabel(row.delta)}
                </td>
                <td className={`${STICKY.b2b} ${rowTone} px-1 py-1 text-center tabular-nums text-gray-600`}>{row.b2b}</td>
                <td className={`${STICKY.next} ${rowTone} px-1 py-1 text-center text-[10px] text-gray-500`}>
                  {row.nextIndex < 0 ? '—' : formatSlateDate(days[row.nextIndex].date, { weekday: 'short', day: 'numeric' })}
                </td>
                {row.plays.map((playing, index) => (
                  <td
                    key={days[index].date}
                    className={`w-[24px] min-w-[24px] px-1 py-1.5 text-center sm:w-[28px] sm:min-w-[28px] ${index === selectedDayIndex ? 'bg-blue-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-[14px] w-[14px] rounded-[3px] sm:h-[16px] sm:w-[16px] ${dotTone(
                        playing,
                        playing && index > 0 && row.plays[index - 1],
                        days[index].slateSize === 0
                      )}`}
                    />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
