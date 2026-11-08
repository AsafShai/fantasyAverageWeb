import { useMemo, useState, type ReactNode } from 'react'
import type { PlayerMatchup, RosterDayPlayer, TimePeriod } from '../../types/api'
import PlayerNameLink from '../../components/PlayerNameLink'
import { MatchupExpandPanel } from '../../components/MatchupDisplay'
import DateRangePicker, { CoverageNotice } from '../../components/DateRangePicker'
import ErrorMessage from '../../components/ErrorMessage'
import { SCHEDULE_HORIZONS, type ScheduleHorizon } from '../../components/PlayerWeekColumns'
import { getErrorMessage } from '../../utils/errorMessage'
import { addDays } from '../../utils/slateWindow'
import { dayLabel, isBench, lineupSlotOrder, lockNote, moveNote, moveTime, pct, starterTotals } from '../../utils/rosterDay'
import { BottomSheet, Button, Card, Chip, ChipRow, InjuryMark, Segmented, SlotPill, useSheetHistory } from '../ui'
import type { MobileTeamDetailProps } from './types'

const MATCHUP_SHEET_ID = 'team-matchup'

// ── shared bits ────────────────────────────────────────────────────────────

function NameCell({ name, id, status, tags }: { name: string; id?: number | null; status?: string | null; tags?: ReactNode }) {
  return (
    <span className="mr-tm-namecell">
      <span>
        <PlayerNameLink name={name} playerId={id} />
      </span>
      {(status || tags) && (
        <span className="mr-tm-tags">
          <InjuryMark status={status} />
          {tags}
        </span>
      )}
    </span>
  )
}

function Th({
  label,
  sortKey,
  sortBy,
  sortOrder,
  onSort,
  className = '',
  pinned = false,
}: {
  label: ReactNode
  sortKey?: string
  sortBy?: string | null
  sortOrder?: 'asc' | 'desc'
  onSort?: (key: string) => void
  className?: string
  pinned?: boolean
}) {
  const active = !!sortKey && sortBy === sortKey
  const cls = `${pinned ? 'mr-pin' : ''} ${className}`.trim() || undefined
  return (
    <th
      scope="col"
      className={cls}
      aria-sort={active ? (sortOrder === 'asc' ? 'ascending' : 'descending') : sortKey ? 'none' : undefined}
    >
      {sortKey && onSort ? (
        <button type="button" className="mr-th-btn" onClick={() => onSort(sortKey)}>
          {label}
          {active && <span aria-hidden="true">{sortOrder === 'asc' ? ' ▲' : ' ▼'}</span>}
        </button>
      ) : (
        <span className="mr-th-label">{label}</span>
      )}
    </th>
  )
}

const slotOf = (slot?: string | null) => (slot ? <SlotPill slot={slot} /> : '—')

/** The matchup projection panel from today's roster, in a bottom sheet. */
function useMatchupSheet() {
  const sheet = useSheetHistory(MATCHUP_SHEET_ID)
  const [matchup, setMatchup] = useState<PlayerMatchup | null>(null)
  const open = (m: PlayerMatchup) => {
    setMatchup(m)
    sheet.show()
  }
  const node = (
    <BottomSheet open={sheet.open && !!matchup} onClose={sheet.hide} title={matchup ? `${matchup.player_name} · vs ${matchup.opponent}` : 'Matchup'}>
      {matchup && <MatchupExpandPanel matchup={matchup} integerProjectionToggle layout="card" minutesStepper />}
    </BottomSheet>
  )
  return { open, node }
}

// ── Daily ──────────────────────────────────────────────────────────────────

function DailyRoster(p: MobileTeamDetailProps) {
  const { rosterDay: day, rosterDayFetching: fetching, rosterDayError: error } = p
  const [lit, setLit] = useState<{ date: string; id: number } | null>(null)
  const matchupSheet = useMatchupSheet()
  const players = useMemo(
    () => (day ? [...day.players].sort((a, b) => lineupSlotOrder(a.lineup_slot) - lineupSlotOrder(b.lineup_slot)) : []),
    [day],
  )
  const starterPlayers = useMemo(() => players.filter((x) => !isBench(x.lineup_slot)), [players])
  const benchPlayers = useMemo(() => players.filter((x) => isBench(x.lineup_slot)), [players])
  const totals = useMemo(() => starterTotals(players), [players])
  // Today nobody has played yet: count the starters who have a game instead.
  const starterGames = day?.is_today ? players.filter((x) => !isBench(x.lineup_slot) && !!x.opponent).length : totals.games
  const date = p.rosterDayDate
  const first = day?.first_date
  const atStart = !!first && date <= first
  const atToday = date >= p.rosterDayLast
  const litId = day && lit?.date === day.date ? lit.id : null
  const pick = (id: number) => day && setLit((prev) => (prev?.id === id && prev.date === day.date ? null : { date: day.date, id }))
  const note = day && !fetching ? lockNote(day) : fetching ? 'Loading this day…' : ''

  const stepper = (
    <div className="mr-row">
      <Button className="mr-icon-btn" aria-label="Previous day" disabled={atStart} onClick={() => p.onRosterDate(addDays(date, -1))}>
        ‹
      </Button>
      <label className="mr-tm-day">
        <span className="mr-select-label">{atToday ? `Today · ${dayLabel(date)}` : dayLabel(date)}</span>
        <span className="mr-caret" aria-hidden="true">▾</span>
        <input
          type="date"
          aria-label="Pick a day"
          value={date}
          min={first}
          max={p.rosterDayLast}
          onChange={(e) => e.target.value && p.onRosterDate(e.target.value)}
        />
      </label>
      <Button className="mr-icon-btn" aria-label="Next day" disabled={atToday} onClick={() => p.onRosterDate(addDays(date, 1))}>
        ›
      </Button>
      {!atToday && (
        <Button size="sm" onClick={() => p.onRosterDate(p.rosterDayLast)}>
          Today
        </Button>
      )}
    </div>
  )

  if (error && !fetching)
    return (
      <>
        {stepper}
        <ErrorMessage message={getErrorMessage(error, 'Failed to load the roster for this day')} />
      </>
    )
  if (!day)
    return (
      <>
        {stepper}
        <span className="mr-meta">Loading this day…</span>
      </>
    )

  const showStats = !day.is_today

  const renderDailyRow = (pl: (typeof players)[number]) => {
    const matchup = day.is_today ? p.matchups.get(pl.player_name) : undefined
    const muted = showStats && (isBench(pl.lineup_slot) || pl.status !== 'played')
    const cls = [litId === pl.player_id && 'mr-lit', muted && 'mr-muted'].filter(Boolean).join(' ')
    return (
      <tr key={pl.player_id} className={cls || undefined} data-testid="roster-day-row">
        <th scope="row" className="mr-pin">
          <NameCell
            name={pl.player_name}
            id={pl.player_id}
            status={matchup?.injury_status}
            tags={
              <>
                {pl.added && <span className="mr-pill mr-square mr-pill-added" title="First day on this roster">Added</span>}
                {pl.dropped && <span className="mr-pill mr-square mr-pill-out" title="Last day on this roster">Dropped</span>}
              </>
            }
          />
        </th>
        <td className="mr-l">{slotOf(pl.lineup_slot)}</td>
        <td className="mr-l">{pl.positions.join('/')}</td>
        <td className="mr-l">{pl.pro_team}</td>
        <td className="mr-l">
          {matchup ? (
            <button type="button" className="mr-tm-opp" onClick={() => matchupSheet.open(matchup)} aria-label={`${pl.player_name} vs ${matchup.opponent}: show matchup and projection`}>
              vs {matchup.opponent} <span aria-hidden="true">›</span>
            </button>
          ) : pl.opponent ? (
            `vs ${pl.opponent}`
          ) : (
            <span title={day.is_today ? 'No game today' : 'No game'}>—</span>
          )}
        </td>
        {showStats && statCells(pl).map((v, i) => <td key={i}>{v}</td>)}
      </tr>
    )
  }

  const moveName = (pl: { player_id: number; name: string; on_roster: boolean }, added: boolean) => {
    const cls = added ? 'mr-tm-add' : 'mr-tm-drop'
    const text = `${added ? 'Added' : 'Dropped'} ${pl.name}`
    return pl.on_roster ? (
      <button key={`${added}${pl.player_id}`} type="button" className={cls} aria-pressed={litId === pl.player_id} title="Highlight in the table" onClick={() => pick(pl.player_id)}>
        {text}
      </button>
    ) : (
      <span key={`${added}${pl.player_id}`} className={cls} title="Not on the roster at this day's lock">
        {text}
      </span>
    )
  }

  const statCells = (pl: RosterDayPlayer): ReactNode[] => {
    const s = pl.stats
    if (pl.status === 'played' && s)
      return [
        s.minutes,
        <>{pct(s.fgm, s.fga)}<span className="mr-tm-sub">{s.fgm}/{s.fga}</span></>,
        <>{pct(s.ftm, s.fta)}<span className="mr-tm-sub">{s.ftm}/{s.fta}</span></>,
        s.three_pm, s.reb, s.ast, s.stl, s.blk, s.pts,
      ]
    return [pl.status === 'dnp' ? 'DNP' : '—', '—', '—', '—', '—', '—', '—', '—', '—']
  }

  return (
    <>
      {stepper}
      {note && <span className="mr-meta" data-testid="roster-day-note">{note}</span>}
      <Card title="Moves" action={day.moves.length ? <span className="mr-meta">{day.moves.length} {day.is_today ? 'today' : 'this day'}</span> : undefined} data-testid="roster-day-moves">
        {day.moves.length === 0 ? (
          <span className="mr-meta">No adds or drops this day</span>
        ) : (
          <div>
            {day.moves.map((m) => {
              const extra = moveNote(m, day.date)
              return (
                <div key={m.id} className="mr-tm-move-row" data-testid="roster-day-move">
                  <span className="mr-meta">
                    {moveTime(m, day.date)}
                    {extra && ` · ${extra}`}
                  </span>
                  <span className="mr-tm-names">
                    {m.added.map((x) => moveName(x, true))}
                    {m.dropped.map((x) => moveName(x, false))}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
      <Card
        title="Roster"
        action={<span className="mr-meta">Starters ({day.is_today ? 'Today' : dayLabel(day.date)}) · {starterGames} {starterGames === 1 ? 'game' : 'games'}</span>}
        className="mr-tm-table"
      >
        {players.length === 0 ? (
          <span className="mr-meta">No roster for this day.</span>
        ) : (
          <div className="mr-tw mr-noscroll" role="region" aria-label="Roster for the day" tabIndex={0}>
            <table className="mr-t" data-testid="roster-day-table">
              <thead>
                <tr>
                  <Th label="PLAYER" pinned />
                  <Th label="SLOT" className="mr-l" />
                  <Th label="POS" className="mr-l" />
                  <Th label="PRO" className="mr-l" />
                  <Th label="OPP" className="mr-l" />
                  {showStats && ['MIN', 'FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'].map((h) => <Th key={h} label={h} />)}
                </tr>
              </thead>
              <tbody>
                {starterPlayers.map(renderDailyRow)}
                {showStats && (
                  <tr className="mr-sum" data-testid="roster-day-totals">
                    <th scope="row" className="mr-pin">Starters ({dayLabel(day.date)})</th>
                    <td className="mr-l" colSpan={4}>
                      {totals.games} {totals.games === 1 ? 'game' : 'games'}
                    </td>
                    {(totals.games
                      ? [
                          totals.minutes,
                          <>{pct(totals.fgm, totals.fga)}<span className="mr-tm-sub">{totals.fgm}/{totals.fga}</span></>,
                          <>{pct(totals.ftm, totals.fta)}<span className="mr-tm-sub">{totals.ftm}/{totals.fta}</span></>,
                          totals.three_pm, totals.reb, totals.ast, totals.stl, totals.blk, totals.pts,
                        ]
                      : Array<ReactNode>(9).fill('—')
                    ).map((v, i) => <td key={i}>{v}</td>)}
                  </tr>
                )}
                {benchPlayers.map(renderDailyRow)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <span className="mr-meta">
        {day.is_today
          ? '🩹 = out · Q/D/P = questionable, doubtful, probable · “—” in OPP = no game. Tap an opponent for the matchup and projection.'
          : 'Box lines for the day; bench and IR are greyed and not in the starters total. Tags mark first/last day on this roster.'}
      </span>
      {matchupSheet.node}
    </>
  )
}

// ── Stats ──────────────────────────────────────────────────────────────────

const PERIODS: { value: TimePeriod; label: string }[] = [
  { value: 'season', label: '📅 Full Season' },
  { value: 'last_7', label: '🔥 Last 7 Days' },
  { value: 'last_15', label: '📊 Last 15 Days' },
  { value: 'last_30', label: '📈 Last 30 Days' },
]

const fmtRange = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function StatsRoster(p: MobileTeamDetailProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const isPct = (k: string) => k === 'fg_percentage' || k === 'ft_percentage'
  const avg = p.teamAverage
  const sortProps = { sortBy: p.sortBy, sortOrder: p.sortOrder, onSort: p.onSort }

  return (
    <>
      <div className="mr-row">
        <Segmented
          label="Values"
          size="sm"
          options={[
            { value: 'avg', label: 'Per Game' },
            { value: 'tot', label: 'Totals' },
          ]}
          value={p.showAverages ? 'avg' : 'tot'}
          onChange={(v) => p.onShowAverages(v === 'avg')}
        />
        {p.showSortReset && (
          <Button size="sm" onClick={p.onResetSort}>
            Reset sort
          </Button>
        )}
      </div>
      <ChipRow label="Period">
        {PERIODS.map((o) => (
          <Chip key={o.value} selected={p.timePeriod === o.value} onClick={() => p.onTimePeriod(o.value)}>
            {o.label}
          </Chip>
        ))}
        <Chip selected={p.timePeriod === 'custom'} aria-expanded={customOpen} onClick={() => setCustomOpen((v) => !v)}>
          📆 Custom
        </Chip>
      </ChipRow>
      {p.timePeriod === 'custom' && p.customRange && !customOpen && (
        <div className="mr-row">
          <Chip
            removable
            aria-label={`Clear custom range ${fmtRange(p.customRange.start)} – ${fmtRange(p.customRange.end)}`}
            onClick={() => {
              p.onCustomRange(null)
              p.onTimePeriod('season')
            }}
          >
            {fmtRange(p.customRange.start)} – {fmtRange(p.customRange.end)}
          </Chip>
        </div>
      )}
      {customOpen && (
        <Card>
          <DateRangePicker
            seasonStart={p.seasonStart}
            initialStart={p.customRange?.start ?? ''}
            initialEnd={p.customRange?.end ?? ''}
            onApply={(range) => {
              p.onCustomRange(range)
              p.onTimePeriod('custom')
              setCustomOpen(false)
            }}
          />
        </Card>
      )}
      {p.timePeriod === 'custom' && p.customRange && (
        <div className="mr-tm-notice">
          <CoverageNotice requestedStart={p.customRange.start} requestedEnd={p.customRange.end} actualStart={p.team.actual_start} actualEnd={p.team.actual_end} />
        </div>
      )}
      {!p.team.players ? (
        <Card>
          <span className="mr-meta">Roster data is currently unavailable. Team stats are from the last known snapshot.</span>
        </Card>
      ) : (
        <div className="mr-tm-table">
          <div className="mr-tw mr-noscroll" role="region" aria-label="Roster stats" tabIndex={0}>
            <table className="mr-t">
              <thead>
                <tr>
                  <Th label="PLAYER" sortKey="player_name" pinned {...sortProps} />
                  <Th label="SLOT" sortKey="lineup_slot" className="mr-l" {...sortProps} />
                  <th scope="col" className="mr-c">
                    <label className="mr-th-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      INCL
                      <input type="checkbox" className="mr-tm-check" checked={p.allIncluded} onChange={p.onToggleAll} aria-label="Include all players" />
                    </label>
                  </th>
                  <Th label="POS" sortKey="positions" className="mr-l" {...sortProps} />
                  <Th label="PRO" sortKey="pro_team" className="mr-l" {...sortProps} />
                  {p.statColumns.map((c) => (
                    <Th key={c.key} label={c.label} sortKey={c.key} {...sortProps} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.players.map((pl, i) => {
                  const noData = pl.has_data === false
                  const matchup = p.matchupsPending ? undefined : p.matchups.get(pl.player_name)
                  return (
                    <tr key={`${pl.player_id ?? pl.player_name}-${i}`}>
                      <th scope="row" className="mr-pin">
                        <NameCell name={pl.player_name} id={pl.player_id} status={matchup?.injury_status} />
                      </th>
                      <td className="mr-l">{slotOf(pl.lineup_slot)}</td>
                      <td className="mr-c">
                        <input
                          type="checkbox"
                          className="mr-tm-check"
                          checked={!noData && p.isIncluded(pl.player_name)}
                          disabled={noData}
                          onChange={() => p.onToggleIncluded(pl.player_name)}
                          aria-label={`Include ${pl.player_name} in team average`}
                          title={noData ? 'Excluded from average — no data for this range' : undefined}
                        />
                      </td>
                      <td className="mr-l">{pl.positions.join('/')}</td>
                      <td className="mr-l">{pl.pro_team}</td>
                      {noData ? (
                        <td className="mr-nodata" colSpan={p.statColumns.length} title="Not available for a custom range — try Last 7/15/30/Season">
                          No data for this range
                        </td>
                      ) : (
                        p.statColumns.map((c) => (
                          <td key={c.key}>
                            {c.key === 'gp' ? pl.stats.gp : p.formatStat(pl.stats[c.key as keyof typeof pl.stats] as number, pl.stats.gp, isPct(c.key))}
                          </td>
                        ))
                      )}
                    </tr>
                  )
                })}
                <tr className="mr-sum">
                  <th scope="row" className="mr-pin">
                    {p.showAverages ? 'Avg' : 'Total'} ({p.periodLabel})
                  </th>
                  <td className="mr-l" colSpan={4}>
                    {p.includedCount} players
                  </td>
                  {p.statColumns.map((c) => (
                    <td key={c.key}>
                      {c.key === 'gp'
                        ? avg.gp
                        : isPct(c.key)
                          ? `${(avg[c.key] * 100).toFixed(2)}%`
                          : p.formatStat(avg[c.key], p.showAverages ? 1 : avg.gp)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <span className="mr-meta">Tap a header to sort. Untick INCL to leave a player out of the team row.</span>
    </>
  )
}

// ── Schedule ───────────────────────────────────────────────────────────────

const HORIZONS = SCHEDULE_HORIZONS.map((h) => ({ value: String(h) as `${ScheduleHorizon}`, label: `${h} days` }))

function ScheduleRoster(p: MobileTeamDetailProps) {
  const sortProps = { sortBy: p.sortBy, sortOrder: p.sortOrder, onSort: p.onSort }
  return (
    <>
      <Segmented
        label="Schedule days"
        size="sm"
        options={HORIZONS}
        value={String(p.horizon) as `${ScheduleHorizon}`}
        onChange={(v) => p.onHorizon(Number(v) as ScheduleHorizon)}
      />
      <ChipRow label="Day">
        {p.weekDays.map((d) => (
          <Chip key={d.date} selected={d.date === p.focusDate} onClick={() => p.onFocusDate(d.date)}>
            {d.weekday} {d.label}
          </Chip>
        ))}
      </ChipRow>
      <Card title={`Who plays${p.whoPlaysHeading ? ` · ${p.whoPlaysHeading}` : ''}?`}>
        {p.whoPlays.length === 0 ? (
          <span className="mr-meta">No games for your roster this day.</span>
        ) : (
          <ul className="mr-tm-who">
            {p.whoPlays.map((pl) => (
              <li key={pl.player_id ?? pl.player_name}>
                {slotOf(pl.lineup_slot)}
                <PlayerNameLink name={pl.player_name} playerId={pl.player_id} />
                <span className="mr-meta">
                  {pl.pro_team} vs {p.focusDate ? p.opponentOn(pl.pro_team, p.focusDate) : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {!p.team.players ? (
        <Card>
          <span className="mr-meta">Roster data is currently unavailable.</span>
        </Card>
      ) : (
        <div className="mr-tm-table">
          <div className="mr-tw mr-noscroll" role="region" aria-label="Roster schedule" tabIndex={0}>
            <table className="mr-t">
              <thead>
                <tr>
                  <Th label="PLAYER" sortKey="player_name" pinned {...sortProps} />
                  <Th label="SLOT" sortKey="lineup_slot" className="mr-l" {...sortProps} />
                  <Th label="POS" sortKey="positions" className="mr-l" {...sortProps} />
                  <Th label="PRO" sortKey="pro_team" className="mr-l" {...sortProps} />
                  {p.weekDays.map((d) => (
                    <th key={d.date} scope="col" className={`mr-c ${d.date === p.focusDate ? 'mr-focus' : ''}`.trim()}>
                      <button type="button" className="mr-th-btn" onClick={() => p.onFocusDate(d.date)} aria-pressed={d.date === p.focusDate}>
                        <span className="mr-th-day">
                          {d.weekday.toUpperCase()}
                          <i>{d.label}</i>
                        </span>
                      </button>
                    </th>
                  ))}
                  <Th label="GAMES" sortKey="week_games" className="mr-c" {...sortProps} />
                </tr>
              </thead>
              <tbody>
                {p.players.map((pl, i) => (
                  <tr key={`${pl.player_id ?? pl.player_name}-${i}`}>
                    <th scope="row" className="mr-pin">
                      <NameCell name={pl.player_name} id={pl.player_id} />
                    </th>
                    <td className="mr-l">{slotOf(pl.lineup_slot)}</td>
                    <td className="mr-l">{pl.positions.join('/')}</td>
                    <td className="mr-l">{pl.pro_team}</td>
                    {p.weekDays.map((d) => {
                      const opp = p.opponentOn(pl.pro_team, d.date)
                      return (
                        <td key={d.date} className={`mr-c ${d.date === p.focusDate ? 'mr-focus' : ''}`.trim()}>
                          {opp ? `vs ${opp}` : ''}
                        </td>
                      )
                    })}
                    <td className="mr-c">
                      <b>{p.gamesIn(pl.pro_team)}</b>
                    </td>
                  </tr>
                ))}
                <tr className="mr-sum">
                  <th scope="row" className="mr-pin">Roster</th>
                  <td className="mr-l" colSpan={3 + p.weekDays.length + 1}>
                    {p.players.filter((x) => x.has_data !== false).length} players
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      <span className="mr-meta">Who plays each day; tap a day to see who plays and to highlight its column.</span>
    </>
  )
}

// ── Roster tab ─────────────────────────────────────────────────────────────

export default function MobileRoster(p: MobileTeamDetailProps) {
  return (
    <>
      <Segmented
        label="Roster view"
        options={[
          { value: 'daily', label: 'Daily' },
          { value: 'stats', label: 'Stats' },
          { value: 'schedule', label: 'Schedule' },
        ]}
        value={p.mode}
        onChange={p.onMode}
      />
      {p.mode === 'daily' ? <DailyRoster {...p} /> : p.mode === 'stats' ? <StatsRoster {...p} /> : <ScheduleRoster {...p} />}
    </>
  )
}

