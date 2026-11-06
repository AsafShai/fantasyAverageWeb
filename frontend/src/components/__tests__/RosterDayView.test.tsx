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

  it('shows stat columns for today in the desktop table', () => {
    renderDay({ ...DAY, is_today: true, date: '2026-11-05', last_date: '2026-11-05' })
    expect(screen.getByRole('columnheader', { name: 'Min' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Player' })).toBeInTheDocument()
    const row = screen.getAllByTestId('roster-day-row')[0]
    expect(within(row).getAllByText('40.00%').length).toBeGreaterThan(0)
    // Today's slate: no starter-aggregate row/card (games still in progress or not summed here).
    expect(screen.queryByTestId('roster-day-totals')).toBeNull()
    expect(screen.queryByTestId('roster-day-mobile-totals')).toBeNull()
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
