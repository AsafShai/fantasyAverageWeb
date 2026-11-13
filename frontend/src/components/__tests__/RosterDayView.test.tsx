import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type { RosterDay } from '../../types/api'
import { RosterDayContent, RosterDayStepper } from '../RosterDayView'

const line = { minutes: 45, fgm: 6, fga: 15, ftm: 2, fta: 3, three_pm: 1, reb: 7, ast: 3, stl: 1, blk: 1, pts: 15, to: 2 }

const DAY: RosterDay = {
  team_id: 1,
  date: '2026-11-02',
  scoring_period_id: 14,
  is_today: false,
  has_games: true,
  lock_at: '2026-11-03T00:00:00Z',
  first_date: '2026-10-20',
  last_date: '2026-11-05',
  players: [
    { player_id: 3, player_name: 'Kawhi Leonard', positions: ['SF', 'PF'], pro_team: 'TOR', lineup_slot: 'BE', opponent: 'LAC', status: 'dnp', stats: null, added: false, dropped: false },
    { player_id: 1, player_name: 'Jarace Walker', positions: ['SF', 'PF'], pro_team: 'IND', lineup_slot: 'PF', opponent: 'ATL', status: 'played', stats: line, added: true, dropped: true },
    { player_id: 2, player_name: 'Zach Edey', positions: ['C'], pro_team: 'MEM', lineup_slot: 'BE', opponent: 'NOP', status: 'played', stats: { ...line, pts: 6 }, added: false, dropped: false },
  ],
  moves: [
    { id: 'a', kind: 'free_agent', at: '2026-11-02T10:14:46Z', after_lock: false,
      added: [{ player_id: 9, name: 'Egor Demin', on_roster: false }], dropped: [{ player_id: 8, name: 'Joan Beringer', on_roster: false }] },
    { id: 'b', kind: 'free_agent', at: '2026-11-02T18:01:13Z', after_lock: false,
      added: [{ player_id: 1, name: 'Jarace Walker', on_roster: true }], dropped: [{ player_id: 9, name: 'Egor Demin', on_roster: false }] },
  ],
}

const renderDay = (day: RosterDay | undefined = DAY, loading = false) =>
  render(<MemoryRouter><RosterDayContent day={day} loading={loading} /></MemoryRouter>)

describe('RosterDayContent', () => {
  it('with onlyPlayed hides DNP and unplayed rows on past days', () => {
    render(
      <MemoryRouter>
        <RosterDayContent day={DAY} loading={false} onlyPlayed />
      </MemoryRouter>,
    )
    const rows = screen.getAllByTestId('roster-day-row')
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['Jarace Walker', 'Zach Edey'])
  })

  it('lists the roster in lineup order with tags, FG% and starter-only totals', () => {
    renderDay()
    const rows = screen.getAllByTestId('roster-day-row')
    expect(rows.map(r => within(r).getByRole('link').textContent)).toEqual(['Jarace Walker', 'Kawhi Leonard', 'Zach Edey'])
    expect(within(rows[0]).getByText('Added')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Dropped')).toBeInTheDocument()
    expect(within(rows[0]).getAllByText('40.00%').length).toBe(1)
    expect(within(rows[0]).getByText('6/15')).toBeInTheDocument()
    expect(within(rows[1]).getByText('DNP')).toBeInTheDocument()
    const totals = screen.getByTestId('roster-day-totals')
    // Edey (bench, 6 pts) is not counted: only Walker's 15.
    expect(within(totals).getAllByText('15').length).toBeGreaterThan(0)
    expect(within(totals).queryByText('21')).toBeNull()
    expect(within(totals).getByText('6/15')).toBeInTheDocument()
  })

  it('shows the moves and highlights a rostered player from the strip', () => {
    renderDay()
    const strip = screen.getByTestId('roster-day-moves')
    expect(within(strip).getAllByText(/Egor Demin/).length).toBe(2)
    // Demin was never on a locked roster: plain text, not a button.
    expect(within(strip).queryByRole('button', { name: /Egor Demin/ })).toBeNull()
    fireEvent.click(within(strip).getByRole('button', { name: /Jarace Walker/ }))
    expect(screen.getAllByTestId('roster-day-row')[0]).toHaveClass('bg-blue-50')
    fireEvent.click(within(strip).getByRole('button', { name: /Jarace Walker/ }))
    expect(screen.getAllByTestId('roster-day-row')[0]).not.toHaveClass('bg-blue-50')
  })

  it('says when there were no moves, and shows the spinner while loading', () => {
    renderDay({ ...DAY, moves: [] })
    expect(screen.getByText('No adds or drops this day')).toBeInTheDocument()
    renderDay(undefined, true)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('hides per-game stat columns for today on desktop (stats stay on past days)', () => {
    renderDay({ ...DAY, is_today: true, date: '2026-11-05', last_date: '2026-11-05' })
    expect(screen.queryByRole('columnheader', { name: 'Min' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'FG%' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Player' })).toBeInTheDocument()
    const row = screen.getAllByTestId('roster-day-row')[0]
    expect(within(row).queryByText('40.00%')).toBeNull()
    // Today's slate: no starter-aggregate row/card (games still in progress or not summed here).
    expect(screen.queryByTestId('roster-day-totals')).toBeNull()
    expect(screen.queryByTestId('roster-day-mobile-totals')).toBeNull()
  })

  const LIVE = { active: true, period: 16, as_of: '2026-11-06T01:42:00Z', games_total: 4, games_live: 2, games_final: 1, official_updated_at: null }
  const liveToday = (live = LIVE): RosterDay => ({
    ...DAY, is_today: true, date: '2026-11-05', last_date: '2026-11-05', live,
    players: [
      { ...DAY.players[1], status: 'live', added: false, dropped: false,
        game: { status: 'live', detail: 'Q3 4:12', start_time: '2026-11-06T00:00:00Z', team_score: 78, opp_score: 71, won: null } },
      { player_id: 4, player_name: 'Ausar Thompson', positions: ['SF'], pro_team: 'DET', lineup_slot: 'SF', opponent: 'WAS', status: 'played',
        stats: { ...line, pts: 12 }, added: false, dropped: false,
        game: { status: 'final', detail: 'Final', start_time: '2026-11-06T00:00:00Z', team_score: 112, opp_score: 104, won: true } },
      { ...DAY.players[0] },
    ],
  })

  it('shows tonight live: lines so far, the game score and clock, and starters so far', () => {
    renderDay(liveToday())
    expect(screen.getByRole('columnheader', { name: 'Min' })).toBeInTheDocument()
    const row = (name: string) => screen.getAllByTestId('roster-day-row').find(r => within(r).queryByText(name))!
    expect(row('Jarace Walker')).toHaveAttribute('data-on-court', 'true')
    expect(row('Ausar Thompson')).not.toHaveAttribute('data-on-court')
    expect(within(row('Jarace Walker')).getByText('78–71 · Q3 4:12')).toBeInTheDocument()
    expect(within(row('Ausar Thompson')).getByText('W 112–104')).toBeInTheDocument()
    const totals = screen.getByTestId('roster-day-totals')
    expect(within(totals).getByText(/Today, so far/)).toBeInTheDocument()
    expect(within(totals).getByText('27')).toBeInTheDocument()     // 15 so far + 12 final
  })

  it('says Today once every game is final', () => {
    renderDay(liveToday({ ...LIVE, games_live: 0, games_final: 4 }))
    expect(within(screen.getByTestId('roster-day-totals')).getByText(/\(Today\)/)).toBeInTheDocument()
  })

  it('shows the final result on past days too', () => {
    const past: RosterDay = { ...DAY, players: [{ ...DAY.players[1], game: { status: 'final', detail: 'Final/OT', start_time: null, team_score: 99, opp_score: 101, won: false } }] }
    renderDay(past)
    expect(within(screen.getByTestId('roster-day-row')).getByText('L 99–101 OT')).toBeInTheDocument()
  })

  it('no spoilers: today shows opponents only, as before live data', () => {
    render(<MemoryRouter><RosterDayContent day={liveToday()} loading={false} noSpoilers /></MemoryRouter>)
    expect(screen.queryByTestId('roster-game-tag')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Min' })).toBeNull()
    expect(screen.queryByTestId('roster-day-totals')).toBeNull()
    expect(screen.getAllByTestId('roster-day-row').some(r => r.hasAttribute('data-on-court'))).toBe(false)
    expect(screen.getByText('vs ATL')).toBeInTheDocument()
  })

})

describe('RosterDayStepper', () => {
  it('steps days and stops at the season start and today', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RosterDayStepper date="2026-11-02" firstDate="2026-10-20" lastDate="2026-11-05" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-01')
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-03')
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(onChange).toHaveBeenLastCalledWith('2026-11-05')
    expect(screen.getByText('Mon, Nov 2')).toBeInTheDocument()

    rerender(<RosterDayStepper date="2026-11-05" firstDate="2026-10-20" lastDate="2026-11-05" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled()
    rerender(<RosterDayStepper date="2026-10-20" firstDate="2026-10-20" lastDate="2026-11-05" onChange={onChange} />)
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled()
  })
})
