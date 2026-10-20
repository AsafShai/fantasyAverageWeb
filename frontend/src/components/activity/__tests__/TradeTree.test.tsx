import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import type { LeagueActivity, PlayerStint, Trade } from '../../../types/activity'
import TradeTree from '../TradeTree'

function stint(id: number, team: number, start: string, over: Partial<PlayerStint> = {}): PlayerStint {
  return {
    player_id: id, name: `Player ${id}`, team_id: team, start, end: start, days: 5, games_played: 6, team_games: 6,
    totals: { PTS: 60, REB: 30, AST: 12 }, exit: 'season_end', exit_trade_id: null, picked_up_after: null, ...over,
  }
}

function trade(id: string, date: string, sides: [number, PlayerStint[]][]): Trade {
  return {
    id, date, accepted_at: null, released_for_trade: [], open_roster_spot: null,
    sides: sides.map(([team_id, received]) => ({ team_id, received })),
  }
}

// Team 1 gets P10 and P11 in t1; flips P10 in t2 for P20; flips P20 in t3 for P30 and P31.
const activity: LeagueActivity = {
  season_id: 2026, season_over: true, latest_date: '2026-04-13', categories: ['PTS'], moves: [], released: [],
  last_updated: '2026-04-14T00:00:00Z',
  teams: [1, 2, 3, 4].map(i => ({ team_id: i, name: `Team ${i}`, abbrev: `T${i}` })),
  trades: [
    trade('t1', '2026-01-05', [[1, [stint(10, 1, '2026-01-05', { exit: 'traded', exit_trade_id: 't2' }), stint(11, 1, '2026-01-05')]], [2, [stint(90, 2, '2026-01-05')]]]),
    trade('t2', '2026-02-01', [[1, [stint(20, 1, '2026-02-01', { exit: 'traded', exit_trade_id: 't3' })]], [3, [stint(10, 3, '2026-02-01')]]]),
    trade('t3', '2026-03-01', [[4, [stint(20, 4, '2026-03-01')]], [1, [stint(30, 1, '2026-03-01'), stint(31, 1, '2026-03-01')]]]),
  ],
}

function renderTree() {
  return renderWithProviders(<TradeTree activity={activity} tradeId="t1" teamId={1} onChange={vi.fn()} onSelectTrade={vi.fn()} />)
}

describe('TradeTree collapsing', () => {
  it('folds a follow-up trade and everything under it, and unfolds it again', async () => {
    const user = userEvent.setup()
    renderTree()
    expect(screen.getByText('Player 30')).toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: 'Collapse trade to T3 on Feb 1' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)

    expect(screen.queryByText('Player 20')).not.toBeInTheDocument()
    expect(screen.queryByText('Player 30')).not.toBeInTheDocument()
    expect(screen.getByText(/got back 3 players \(hidden\)/)).toBeInTheDocument()
    expect(screen.getByText('Player 11')).toBeInTheDocument() // sibling branch stays

    await user.click(screen.getByRole('button', { name: 'Expand trade to T3 on Feb 1' }))
    expect(screen.getByText('Player 30')).toBeInTheDocument()
  })

  it('folds only the inner trade when that is the one toggled', async () => {
    const user = userEvent.setup()
    renderTree()
    await user.click(screen.getByRole('button', { name: 'Collapse trade to T4 on Mar 1' }))

    expect(screen.getByText('Player 20')).toBeInTheDocument()
    expect(screen.queryByText('Player 31')).not.toBeInTheDocument()
    expect(screen.getByText(/got back 2 players \(hidden\)/)).toBeInTheDocument()
  })

  it('collapses and expands everything at once', async () => {
    const user = userEvent.setup()
    renderTree()
    const expandAll = screen.getByRole('button', { name: 'Expand all' })
    expect(expandAll).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('Player 20')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse all' })).toBeDisabled()

    await user.click(expandAll)
    const tree = screen.getByText('Player 10').closest('ul') as HTMLElement
    expect(within(tree).getByText('Player 31')).toBeInTheDocument()
  })
})
