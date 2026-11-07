import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import type { LeagueActivity } from '../../../types/activity'
import MobileActivityFeed from '../MobileActivityFeed'

vi.mock('../../flag', () => ({ useMobileRedesign: () => true }))

const ACTIVITY = {
  season_id: 2027, season_over: false, latest_date: '2026-11-06', categories: [], trades: [], released: [], last_updated: '',
  teams: [
    { team_id: 1, name: "Asaf's Astounding Team", abbrev: 'LA' },
    { team_id: 2, name: 'DORELIT', abbrev: 'DOR' },
  ],
  moves: [
    { id: 'a', kind: 'add', at: '2026-11-06T17:51:00Z', team_id: 1, other_team_id: null, trade_id: null, added: [{ player_id: 1, name: 'Terrence Shannon Jr.' }], dropped: [{ player_id: 2, name: 'Collin Gillespie' }] },
    { id: 'b', kind: 'waiver', at: '2026-11-06T15:08:00Z', team_id: 2, other_team_id: null, trade_id: null, added: [{ player_id: 3, name: "Ja'Kobe Walter" }], dropped: [{ player_id: 4, name: 'Jakob Poeltl' }] },
    { id: 'c', kind: 'trade', at: '2026-11-05T15:00:00Z', team_id: 1, other_team_id: 2, trade_id: 't1', added: [{ player_id: 5, name: 'Jared McCain' }], dropped: [{ player_id: 6, name: 'Charles Bassey' }] },
  ],
} as unknown as LeagueActivity

describe('MobileActivityFeed', () => {
  it('groups moves by day with counts, kind badges and trade sides', () => {
    renderWithProviders(<MobileActivityFeed activity={ACTIVITY} />, { route: '/activity' })
    expect(screen.getByText('3 moves · 1 adds · 0 drops · 1 waiver claims · 1 trades')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Moves' })
    expect(within(list).getByText('Fri, Nov 6')).toBeInTheDocument()
    expect(within(list).getByText('Thu, Nov 5')).toBeInTheDocument()
    expect(within(list).getByText('Added')).toBeInTheDocument()
    expect(within(list).getByText('Waiver claim')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'Trade' })).toHaveAttribute('href', '/activity?tab=trades&trade=t1')
    expect(within(list).getByText('LA ⇄ DOR')).toBeInTheDocument()
    expect(within(list).getByRole('link', { name: 'Terrence Shannon Jr.' })).toHaveAttribute('href', '/activity?player=1')
  })

  it('Team and Type are bottom-sheet pickers', async () => {
    renderWithProviders(<MobileActivityFeed activity={ACTIVITY} />, { route: '/activity' })
    await userEvent.click(screen.getByRole('button', { name: 'Type: All moves' }))
    await userEvent.click(screen.getByRole('option', { name: 'Trades' }))
    const list = screen.getByRole('list', { name: 'Moves' })
    expect(within(list).queryByText('Added')).toBeNull()
    expect(within(list).getByText('LA ⇄ DOR')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Type: Trades' }))
    await userEvent.click(screen.getByRole('option', { name: 'All moves' }))
    await userEvent.click(screen.getByRole('button', { name: 'Team: All teams' }))
    await userEvent.click(screen.getByRole('option', { name: 'DORELIT' }))
    expect(screen.getByText('2 moves · 0 adds · 0 drops · 1 waiver claims · 1 trades')).toBeInTheDocument()
  })

  it('date range narrows the feed and says when nothing matches', async () => {
    renderWithProviders(<MobileActivityFeed activity={ACTIVITY} />, { route: '/activity' })
    const from = screen.getByLabelText('From')
    await userEvent.type(from, '2026-12-01')
    expect(screen.getByText('No moves match these filters.')).toBeInTheDocument()
  })
})
