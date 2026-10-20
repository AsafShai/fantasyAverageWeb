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

describe('TradeTree root', () => {
  it('starts with the followed trade: who it was with, when, and what this side sent', async () => {
    const user = userEvent.setup()
    const onSelectTrade = vi.fn()
    renderWithProviders(<TradeTree activity={activity} tradeId="t1" teamId={1} onChange={vi.fn()} onSelectTrade={onSelectTrade} />)

    const root = screen.getByRole('button', { name: 'T1 ⇄ T2 · Jan 5' })
    expect(screen.getByRole('heading', { name: /T1 ⇄ T2 · Jan 5/ })).toBeInTheDocument()
    expect(screen.getByText('Sent to T2').nextElementSibling).toHaveTextContent('Player 90')
    expect(screen.getByText('Got from T2').nextElementSibling).toHaveTextContent('Player 10, Player 11')
    await user.click(root)
    expect(onSelectTrade).toHaveBeenCalledWith('t1')
  })

  it('names what the other side sent when following it', () => {
    renderWithProviders(<TradeTree activity={activity} tradeId="t1" teamId={2} onChange={vi.fn()} onSelectTrade={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'T2 ⇄ T1 · Jan 5' })).toBeInTheDocument()
    expect(screen.getByText('Sent to T1').nextElementSibling).toHaveTextContent('Player 10, Player 11')
    expect(screen.getByText('Got from T1').nextElementSibling).toHaveTextContent('Player 90')
  })
})

describe('TradeTree side switch', () => {
  it('shows both teams as buttons and switches sides', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<TradeTree activity={activity} tradeId="t1" teamId={1} onChange={onChange} onSelectTrade={vi.fn()} />)

    const follow = screen.getByRole('group', { name: 'Follow' })
    expect(within(follow).getByRole('button', { name: 'T1' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(follow).getByRole('button', { name: 'T2' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(follow).getByRole('button', { name: 'T2' }))
    expect(onChange).toHaveBeenCalledWith('t1', 2)
  })

  it('starts on the first team when no side is asked for and my team is not in the trade', () => {
    renderWithProviders(<TradeTree activity={activity} tradeId="t1" teamId={null} onChange={vi.fn()} onSelectTrade={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /T1 ⇄ T2/ })).toBeInTheDocument()
  })

  it('lets the default side apply again when another trade is picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderWithProviders(<TradeTree activity={activity} tradeId="t1" teamId={2} onChange={onChange} onSelectTrade={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Trade'), 't3')
    expect(onChange).toHaveBeenCalledWith('t3', 0)
  })
})

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
    // one player came back directly (P20); his branch holds three in all
    expect(screen.getByText(/got back 1 player \(3 in this branch, hidden\)/)).toBeInTheDocument()
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

describe('TradeTree default folding', () => {
  // Team 1 gets P10..P12 in t1; trades each for three players (t2..t4), and
  // flips P20 again in t5: 3 + 9 + 1 = 13 players, over the auto-expand limit.
  const big: LeagueActivity = {
    ...activity,
    trades: [
      trade('t1', '2026-01-05', [[1, [10, 11, 12].map((id, i) =>
        stint(id, 1, '2026-01-05', { exit: 'traded', exit_trade_id: `t${i + 2}` }))], [2, [stint(90, 2, '2026-01-05')]]]),
      ...[0, 1, 2].map(i => trade(`t${i + 2}`, `2026-02-0${i + 1}`, [
        [1, [0, 1, 2].map(j => stint(20 + i * 3 + j, 1, `2026-02-0${i + 1}`,
          i === 0 && j === 0 ? { exit: 'traded', exit_trade_id: 't5' } : {}))],
        [3, [stint(10 + i, 3, `2026-02-0${i + 1}`)]],
      ])),
      trade('t5', '2026-03-01', [[4, [stint(20, 4, '2026-03-01')]], [1, [stint(40, 1, '2026-03-01')]]]),
    ],
  }

  it('opens one level of follow-ups on a big tree and folds the rest', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TradeTree activity={big} tradeId="t1" teamId={1} onChange={vi.fn()} onSelectTrade={vi.fn()} />)

    expect(screen.getByText(/13 players/)).toBeInTheDocument()
    expect(screen.getByText('Player 22')).toBeInTheDocument() // first level: open
    expect(screen.queryByText('Player 40')).not.toBeInTheDocument() // second level: folded
    expect(screen.getByRole('button', { name: 'Expand trade to T4 on Mar 1' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText(/got back 1 player \(hidden\)/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('Player 40')).toBeInTheDocument()
  })

  it('opens a small tree fully', () => {
    renderTree() // 5 players
    expect(screen.getByText('Player 30')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeDisabled()
  })
})
