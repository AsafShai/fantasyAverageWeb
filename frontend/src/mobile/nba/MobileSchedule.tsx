import { useMemo, useState } from 'react'
import type { ScheduleResponse, ScheduleTeam } from '../../types/api'
import { METRIC_GLOSSARY } from '../../constants/metricGlossary'
import InfoTip from '../../components/InfoTip'
import { useSlateCalendar, SLATE_PRESETS } from '../../hooks/useSlateCalendar'
import { HIGH_VOLUME_GAMES, formatSlateDate, type SlateDay, type SlateTeamRow } from '../../utils/slateWindow'
import { Card, Chip, ChipRow, Segmented } from '../ui'
import './nba.css'

export type ScheduleGrain = 'months' | 'weeks'

interface MobileScheduleProps {
  data: ScheduleResponse
  grain: ScheduleGrain
  onGrain: (grain: ScheduleGrain) => void
  columns: string[]
  valueFor: (team: ScheduleTeam, column: string) => number
  /** 0 = no games, 1 = low, 2 = mid, 3 = high (same thresholds as desktop). */
  heatLevel: (value: number) => 0 | 1 | 2 | 3
}

const BAR_AREA_PX = 110

/**
 * Season Schedule on a phone (step 5): NBA Cup note, games-per-night chart
 * with the window chips, tonight's matchups, the Who-plays-when grid and the
 * month/week density table. State and data stay in pages/Schedule.
 */
export default function MobileSchedule({ data, grain, onGrain, columns, valueFor, heatLevel }: MobileScheduleProps) {
  const scheduleGap = data.published_games_min > 0 && data.published_games_min < 82
  return (
    <div className="mr-root mr-nba" data-testid="mobile-schedule">
      <div className="mr-nba-head">
        <h1 className="mr-nba-title">Season schedule</h1>
        <p className="mr-nba-lede">A full-season NBA schedule through a fantasy lens: density, rest, back-to-backs, and where each team’s games land by month.</p>
      </div>

      {scheduleGap && (
        <div className="mr-nba-info">
          <b>{data.published_games_min} games are published per team right now.</b>{' '}
          Two slots are held for the NBA Cup knockout round and are filled around mid-December; this is expected, not missing data.
        </div>
      )}

      <SlateCards schedule={data} />

      <Card aria-labelledby="mr-nba-season">
        <h2 id="mr-nba-season" className="mr-h2">Season {data.season}</h2>
        <span className="mr-meta">
          Blue cells show relative {grain === 'months' ? 'month' : 'week'} density.{' '}
          <span className="mr-nba-key"><i className="mr-nba-heat-3" /> higher count</span>
        </span>
        <Segmented
          label="Group by"
          size="sm"
          options={[{ value: 'months', label: 'Months' }, { value: 'weeks', label: 'Weeks' }]}
          value={grain}
          onChange={onGrain}
          className="mr-nba-grow-0"
        />
        <div className="mr-tw mr-nba-scroll">
          <table className="mr-t mr-nba-density" aria-label={`Games per ${grain === 'months' ? 'month' : 'week'}`}>
            <thead>
              <tr>
                <th scope="col" className="mr-pin mr-l"><span className="mr-th-label">TEAM</span></th>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    <span className="mr-th-label">
                      {grain === 'months' ? column.slice(0, 3).toUpperCase() : formatSlateDate(column, { month: 'short', day: 'numeric' })}
                    </span>
                  </th>
                ))}
                <th scope="col"><span className="mr-th-label mr-nba-th-tip">TOTAL<InfoTip title={METRIC_GLOSSARY.scheduleTotal.title} body={METRIC_GLOSSARY.scheduleTotal.body} /></span></th>
                <th scope="col"><span className="mr-th-label mr-nba-th-tip">B2B<InfoTip title={METRIC_GLOSSARY.scheduleB2B.title} body={METRIC_GLOSSARY.scheduleB2B.body} /></span></th>
                <th scope="col"><span className="mr-th-label mr-nba-th-tip">HIGH VOLUME<InfoTip title={METRIC_GLOSSARY.scheduleHighVolume.title} body={METRIC_GLOSSARY.scheduleHighVolume.body} /></span></th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((team) => (
                <tr key={team.team_id}>
                  <th scope="row" className="mr-pin mr-l mr-nba-abbr" title={team.team_name}>{team.abbreviation}</th>
                  {columns.map((column) => {
                    const value = valueFor(team, column)
                    return <td key={column} className={`mr-nba-heat-${heatLevel(value)}`}>{value}</td>
                  })}
                  <td className="mr-nba-strong">{team.total_games}</td>
                  <td>{team.b2b_count}</td>
                  <td>{team.high_volume_games}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mr-meta mr-nba-note">
          {grain === 'weeks' && 'Weeks start Monday. '}
          High-volume means {data.high_volume_threshold}+ NBA games league-wide on that date. This page reports schedule shape; it does not prescribe roster moves.
        </p>
      </Card>
    </div>
  )
}

function TraceChip({ abbreviation, traced, onToggle }: { abbreviation: string; traced: boolean; onToggle: (a: string) => void }) {
  return (
    <button
      type="button"
      className="mr-nba-trace"
      aria-pressed={traced}
      aria-label={traced ? `Stop tracing ${abbreviation}` : `Trace ${abbreviation} across the window`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(abbreviation)
      }}
    >
      {abbreviation}
    </button>
  )
}

function SlateCards({ schedule }: { schedule: ScheduleResponse }) {
  const cal = useSlateCalendar(schedule)
  const { days, rows, window, dayIndex, selectedDay, maxSlate, tracedTeam, toggleTeam } = cal
  if (!days.length) return null

  const windowOptions = [...SLATE_PRESETS.map((n) => ({ value: String(n), label: `${n} days` })), { value: 'custom', label: 'Pick an end date' }]
  const linePx = 2 + (BAR_AREA_PX - 4) * (1 - HIGH_VOLUME_GAMES / maxSlate)

  return (
    <>
      <Card aria-labelledby="mr-nba-gpn">
        <ChipRow label="Window">
          {windowOptions.map((o) => (
            <Chip
              key={o.value}
              selected={String(cal.mode) === o.value}
              onClick={() => cal.chooseMode(o.value === 'custom' ? 'custom' : (Number(o.value) as 7 | 14 | 28))}
            >
              {o.label}
            </Chip>
          ))}
        </ChipRow>
        <label className={`mr-nba-through ${cal.mode === 'custom' ? 'mr-on' : ''}`.trim()}>
          <span className="mr-meta">through</span>
          <input
            type="date"
            value={cal.draftEnd ?? cal.endDate}
            min={cal.minEnd}
            max={cal.lastDate}
            disabled={cal.mode !== 'custom'}
            onChange={(e) => cal.typeEnd(e.target.value)}
            onBlur={cal.clearDraft}
          />
        </label>
        {cal.mode !== 'custom' && <span className="mr-meta">choose “Pick an end date” to set your own</span>}

        {tracedTeam && (
          <div className="mr-nba-tracing" role="status">
            <span>
              Tracing <b>{tracedTeam}</b> — {cal.tracedNights} game{cal.tracedNights === 1 ? '' : 's'} in this window, highlighted below
            </span>
            <button type="button" className="mr-link" onClick={cal.clearTrace}>Clear</button>
          </div>
        )}

        <h2 id="mr-nba-gpn" className="mr-h2 mr-nba-th-tip">
          Games per night
          <InfoTip title={METRIC_GLOSSARY.slateSize.title} body={METRIC_GLOSSARY.slateSize.body} />
        </h2>
        <span className="mr-meta">
          {window.totalGames} games over {days.length} nights · {window.highVolumeNights} night
          {window.highVolumeNights === 1 ? '' : 's'} at {HIGH_VOLUME_GAMES}+ games
          {window.darkNights > 0 && ` · ${window.darkNights} night${window.darkNights === 1 ? '' : 's'} with no games at all`}
        </span>

        <div className="mr-nba-bars-wrap">
          <div className="mr-nba-bars mr-noscroll">
            {days.map((day, index) => {
              const playing = tracedTeam ? day.matchups.some((m) => m.away === tracedTeam || m.home === tracedTeam) : null
              const hv = day.slateSize >= HIGH_VOLUME_GAMES
              return (
                <button
                  key={day.date}
                  type="button"
                  className="mr-nba-bar"
                  aria-pressed={index === dayIndex}
                  title={`${formatSlateDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })} — ${day.slateSize} game${day.slateSize === 1 ? '' : 's'}`}
                  onClick={() => cal.setSelectedDayIndex(index)}
                >
                  <span className="mr-nba-bar-v">{day.slateSize}</span>
                  <span className="mr-nba-bar-area" style={{ height: BAR_AREA_PX }}>
                    <span
                      className={`mr-nba-bar-fill ${hv ? 'mr-hv' : ''} ${playing === false ? 'mr-dim' : ''} ${playing === true ? 'mr-traced' : ''}`}
                      style={{ height: `${(day.slateSize / maxSlate) * 100}%` }}
                    />
                    {day.slateSize === 0 && <span className="mr-nba-bar-none" />}
                  </span>
                  <span className="mr-nba-bar-d">
                    {formatSlateDate(day.date, { weekday: 'short' })}
                    <br />
                    {formatSlateDate(day.date, { month: 'numeric', day: 'numeric' })}
                  </span>
                </button>
              )
            })}
          </div>
          {maxSlate >= HIGH_VOLUME_GAMES && (
            <div aria-hidden="true" className="mr-nba-line" style={{ top: 18 + linePx }}>
              <span>{HIGH_VOLUME_GAMES} games</span>
            </div>
          )}
        </div>

        <div className="mr-nba-legend">
          <span><i className="mr-nba-lg mr-lg-play" />games that night</span>
          <span><i className="mr-nba-lg mr-lg-hv" />high-volume night ({HIGH_VOLUME_GAMES}+)</span>
          <span><i className="mr-nba-lg mr-lg-dash" />the {HIGH_VOLUME_GAMES}-game line</span>
          <span><i className="mr-nba-lg mr-lg-dot" />no games</span>
        </div>

        <div className="mr-nba-night">
          <div className="mr-card-head">
            <h3 className="mr-h2">{formatSlateDate(selectedDay.date, { weekday: 'long', month: 'short', day: 'numeric' })}</h3>
            <span className={`mr-pill ${selectedDay.slateSize >= HIGH_VOLUME_GAMES ? 'mr-pill-quest' : 'mr-pill-bench'}`}>
              {selectedDay.slateSize === 0 ? 'no games' : `${selectedDay.slateSize} games`}
              {selectedDay.slateSize >= HIGH_VOLUME_GAMES && ' · high volume'}
            </span>
          </div>
          <span className="mr-meta">
            {selectedDay.slateSize === 0 ? 'every team is off' : `${selectedDay.slateSize * 2} of 30 teams active · tap any team to trace it`}
          </span>
          <div className="mr-nba-mups">
            {selectedDay.matchups.map((m) => (
              <span key={`${m.away}-${m.home}`} className="mr-nba-mup">
                <TraceChip abbreviation={m.away} traced={m.away === tracedTeam} onToggle={toggleTeam} />
                <span className="mr-meta">@</span>
                <TraceChip abbreviation={m.home} traced={m.home === tracedTeam} onToggle={toggleTeam} />
              </span>
            ))}
          </div>
        </div>
      </Card>

      <Card aria-labelledby="mr-nba-who">
        <h2 id="mr-nba-who" className="mr-h2">Who plays when</h2>
        <span className="mr-meta">
          tap a team to trace it · tap a column header to sort · Teams play {window.minGames}–{window.maxGames} games in this window · {window.ordinaryTeams} of {rows.length} at {window.modalGames}
        </span>
        <NightGrid days={days} rows={rows} selectedDayIndex={dayIndex} tracedTeam={tracedTeam} onSelectDay={cal.setSelectedDayIndex} onToggleTeam={toggleTeam} />
        <div className="mr-nba-legend">
          <span><i className="mr-nba-lg mr-lg-play" />plays</span>
          <span><i className="mr-nba-lg mr-lg-b2b" />second night of a back-to-back</span>
          <span><i className="mr-nba-lg mr-lg-off" />off</span>
          <span><i className="mr-nba-lg mr-lg-dark" />league-wide dark night</span>
        </div>
        <p className="mr-meta mr-nba-note">
          <b>G</b> = games in the window. <b>Δ</b> = whole games above or below the count most teams have; <b>—</b> means ordinary.{' '}
          <b>B2B</b> = back-to-backs inside the window. <b>Next</b> = first game from today.
          Nights are <b>US Eastern game dates</b>, the same dates ESPN scores against.
        </p>
      </Card>
    </>
  )
}

type SortKey = 'abbreviation' | 'games' | 'delta' | 'b2b' | 'nextIndex'

function NightGrid({ days, rows, selectedDayIndex, tracedTeam, onSelectDay, onToggleTeam }: {
  days: SlateDay[]
  rows: SlateTeamRow[]
  selectedDayIndex: number
  tracedTeam: string | null
  onSelectDay: (index: number) => void
  onToggleTeam: (abbreviation: string) => void
}) {
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
    return [...rows].sort((a, b) => compare[sortKey](a, b) * sortDir || a.abbreviation.localeCompare(b.abbreviation))
  }, [rows, sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) return setSortDir((d) => (d === 1 ? -1 : 1))
    setSortKey(key)
    setSortDir(key === 'abbreviation' || key === 'nextIndex' ? 1 : -1)
  }

  const head = (key: SortKey, label: string, cls: string, tip?: keyof typeof METRIC_GLOSSARY) => (
    <th scope="col" className={cls} aria-sort={sortKey === key ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'}>
      <span className="mr-nba-th-tip">
        <button type="button" className="mr-th-btn" onClick={() => toggleSort(key)}>
          {label}{sortKey === key ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}
        </button>
        {tip && <InfoTip title={METRIC_GLOSSARY[tip].title} body={METRIC_GLOSSARY[tip].body} />}
      </span>
    </th>
  )

  return (
    <div className="mr-tw mr-nba-scroll mr-nba-grid-wrap">
      <table className="mr-t mr-nba-grid" aria-label="Who plays when">
        <thead>
          <tr>
            {head('abbreviation', 'TEAM', 'mr-pin mr-l')}
            {head('games', 'G', 'mr-c')}
            {head('delta', 'Δ', 'mr-c', 'slateDelta')}
            {head('b2b', 'B2B', 'mr-c', 'slateB2B')}
            {head('nextIndex', 'NEXT', 'mr-l')}
            {days.map((day, index) => (
              <th
                key={day.date}
                scope="col"
                className={`mr-c mr-nba-day ${index === selectedDayIndex ? 'mr-sel' : ''} ${day.slateSize === 0 ? 'mr-dark' : ''}`}
                title={`${formatSlateDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })} — ${day.slateSize} games`}
              >
                <button type="button" className="mr-th-btn" onClick={() => onSelectDay(index)}>
                  {formatSlateDate(day.date, { weekday: 'narrow' })}
                  <br />
                  {formatSlateDate(day.date, { day: 'numeric' })}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const traced = row.abbreviation === tracedTeam
            const dimmed = tracedTeam !== null && !traced
            return (
              <tr key={row.abbreviation} className={`${traced ? 'mr-me' : ''} ${dimmed ? 'mr-nba-dimmed' : ''}`.trim() || undefined}>
                <th scope="row" className="mr-pin mr-l">
                  <TraceChip abbreviation={row.abbreviation} traced={traced} onToggle={onToggleTeam} />
                </th>
                <td className="mr-c mr-nba-strong">{row.games}</td>
                <td className={`mr-c mr-nba-strong ${row.delta > 0 ? 'mr-nba-up' : row.delta < 0 ? 'mr-nba-down' : 'mr-nba-faint'}`}>
                  {row.delta === 0 ? '—' : row.delta > 0 ? `+${row.delta}` : row.delta}
                </td>
                <td className="mr-c">{row.b2b}</td>
                <td className="mr-l">{row.nextIndex < 0 ? '—' : formatSlateDate(days[row.nextIndex].date, { weekday: 'short', day: 'numeric' })}</td>
                {row.plays.map((playing, index) => {
                  const b2b = playing && index > 0 && row.plays[index - 1]
                  const tone = playing ? (b2b ? 'mr-b2b' : 'mr-play') : days[index].slateSize === 0 ? 'mr-darknight' : 'mr-off'
                  return (
                    <td key={days[index].date} className={`mr-c mr-nba-cell ${index === selectedDayIndex ? 'mr-sel' : ''}`}>
                      <span className={`mr-nba-dot ${tone}`} />
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
