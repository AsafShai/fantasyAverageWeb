import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../../test/helpers'
import LeagueHistoryView from '../LeagueHistoryView'
import type { PlayerLeagueHistory } from '../../../types/activity'

const history: PlayerLeagueHistory = {
  season_id: 2026,
  player_id: 10,
  teams: [
    { team_id: 2, name: 'Machlins team', abbrev: 'MT' },
    { team_id: 1, name: 'DORELIT', abbrev: 'LA' },
  ],
  moves: [{
    id: 'd',
    kind: 'draft',
    at: '2026-10-15T16:00:00Z',
    team_id: 1,
    from_team_id: null,
    pick: 4,
    round: 1,
    swapped: [],
    in_trade: false,
    trade_sides: [],
    trade_drops: [],
  }],
  stints: [{ team_id: 1, start: '2026-10-15T16:00:00Z', end: null }],
  categories: ['PTS', 'FG%'],
  stint_stats_ready: true,
  stint_stats: [{
    team_id: 2,
    start: '2026-11-14',
    end: '2026-11-15',
    current: true,
    games_played: 2,
    totals: { PTS: 20, FGM: 8, FGA: 16 },
    started: { gp: 1, totals: { PTS: 16, FGM: 6, FGA: 10 } },
    bench: { gp: 1, totals: { PTS: 4, FGM: 2, FGA: 6 } },
    ir: null,
    unsplit_games: 1,
  }],
  last_updated: '2026-11-15T00:00:00Z',
}

describe('fantasy team stat lines', () => {
  it('shows each stretch above the moves, with started and bench', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LeagueHistoryView history={history} />)

    const text = document.body.textContent ?? ''
    expect(text.indexOf('With each team')).toBeGreaterThan(-1)
    expect(text.indexOf('With each team')).toBeLessThan(text.indexOf('Moves, newest first'))
    expect(screen.queryByText('Started')).toBeNull()
    expect(screen.queryByText('Bench')).toBeNull()
    expect(screen.queryByText('IR')).toBeNull()
    expect(screen.getByText('1 game not split')).toBeTruthy()
    expect(screen.getByText('10.0')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /MT/ }))
    expect(screen.getByText('Started')).toBeTruthy()
    expect(screen.getByText('Bench')).toBeTruthy()
    expect(screen.getByText('16.0')).toBeTruthy()
    expect(screen.getByText('4.0')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Totals' }))
    expect(screen.queryByText('10.0')).toBeNull()
    expect(screen.getAllByText('20').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0.500').length).toBeGreaterThan(0)
  })

  it('opens started and bench under the team row on a phone', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LeagueHistoryView history={history} />)
    const mobile = screen.getByTestId('stint-table')

    expect(within(mobile).queryByText('Started')).toBeNull()
    expect(within(mobile).queryByText('Bench')).toBeNull()
    expect(within(mobile).getByText('10.0')).toBeTruthy()

    await user.click(within(mobile).getByRole('button', { name: /MT/ }))
    expect(within(mobile).getByText('Started')).toBeTruthy()
    expect(within(mobile).getByText('Bench')).toBeTruthy()
    expect(within(mobile).getByText('16.0')).toBeTruthy()
    expect(within(mobile).getByText('4.0')).toBeTruthy()

    await user.click(within(mobile).getByRole('button', { name: /MT/ }))
    expect(within(mobile).queryByText('Started')).toBeNull()
  })

  it('sorts teams by the team line and keeps the split underneath', async () => {
    const user = userEvent.setup()
    const ranked: PlayerLeagueHistory = {
      ...history,
      teams: [...history.teams, { team_id: 3, name: 'Zero', abbrev: 'ZZ' }],
      stint_stats: [
        {
          ...history.stint_stats![0],
          games_played: 1,
          totals: { PTS: 30, FGM: 8, FGA: 16 },
          started: { gp: 1, totals: { PTS: 30, FGM: 8, FGA: 16 } },
          bench: { gp: 0, totals: {} },
        },
        {
          team_id: 1,
          start: '2026-10-20',
          end: '2026-10-27',
          current: false,
          games_played: 4,
          totals: { PTS: 40, FGM: 10, FGA: 40 },
          started: { gp: 1, totals: { PTS: 4, FGM: 1, FGA: 4 } },
          bench: { gp: 3, totals: { PTS: 36, FGM: 9, FGA: 36 } },
          unsplit_games: 0,
        },
        {
          team_id: 3,
          start: '2026-11-01',
          end: '2026-11-02',
          current: false,
          games_played: 0,
          totals: {},
          started: { gp: 0, totals: {} },
          bench: { gp: 0, totals: {} },
          unsplit_games: 0,
        },
      ],
    }
    renderWithProviders(<LeagueHistoryView history={ranked} />)
    const table = screen.getByTestId('stint-table')
    const names = () => [...table.querySelectorAll('tbody th')].map((th) => th.textContent ?? '')

    expect(names()[0]).toContain('MT')
    await user.click(within(table).getByRole('button', { name: 'PTS' }))
    expect(within(table).getByRole('columnheader', { name: 'PTS' })).toHaveAttribute('aria-sort', 'descending')
    // Per game: MT 30.0, LA 10.0. A team with no games stays last, not treated as zero.
    expect(names()[0]).toContain('MT')
    expect(names()[1]).toContain('LA')
    expect(names()[2]).toContain('ZZ')

    await user.click(within(table).getByRole('button', { name: /MT/ }))
    await user.click(screen.getByRole('button', { name: 'Totals' }))
    // Totals flip them: LA 40, MT 30. Started and Bench stay under MT.
    const rows = names()
    expect(rows[0]).toContain('LA')
    expect(rows[1]).toContain('MT')
    expect(rows[2]).toContain('Started')
    expect(rows[3]).toContain('Bench')
    expect(rows[4]).toContain('ZZ')
  })

  it('keeps the moves when the stat lines could not be loaded', () => {
    renderWithProviders(<LeagueHistoryView history={{ ...history, stint_stats: [], stint_stats_ready: false }} />)
    expect(screen.getByText('Stat lines could not be loaded.')).toBeTruthy()
    expect(screen.getByText('Moves, newest first')).toBeTruthy()
    const text = document.body.textContent ?? ''
    expect(text.indexOf('Stat lines could not be loaded.')).toBeLessThan(text.indexOf('Moves, newest first'))
  })
})