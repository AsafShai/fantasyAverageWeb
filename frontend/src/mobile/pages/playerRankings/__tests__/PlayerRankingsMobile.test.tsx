import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../../../../types/api'
import { renderWithProviders } from '../../../../test/helpers'
import PlayerRankings from '../../../../pages/PlayerRankings'

vi.mock('../../../flag', () => ({ useMobileRedesign: () => true }))

function player(name: string, positions: string[], teamId: number, minutes: number, gp: number, pts: number, id: number): Player {
  return {
    player_name: name,
    player_id: id,
    pro_team: 'LAL',
    positions,
    stats: {
      pts, reb: 5 * gp, ast: 5 * gp, stl: gp, blk: gp, three_pm: 2 * gp,
      fg_percentage: 0.47, ft_percentage: 0.85,
      fgm: 8 * gp, fga: 17 * gp, ftm: 4 * gp, fta: 5 * gp,
      minutes, gp,
    },
    team_id: teamId,
    status: teamId ? 'ONTEAM' : 'FREEAGENT',
  } as Player
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

describe('Player Rankings · phone redesign', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/players/')) {
        return json({
          players: [
            player('Alpha Guard', ['PG'], 1, 700, 20, 600, 11),
            player('Beta Wing', ['SF'], 0, 300, 10, 150, 12),
            player('Gamma Big', ['C'], 2, 200, 4, 40, 13),
          ],
          total_count: 3, page: 1, limit: 1200, has_more: false,
        })
      }
      if (url.includes('/teams/')) return json([{ team_id: 1, team_name: 'Alpha Team', abbrev: 'ALP' }, { team_id: 2, team_name: 'Bravo Team', abbrev: 'BRV' }])
      if (url.includes('/league/summary')) return json({ season_start: '2025-10-21' })
      return new Response('not found', { status: 404 })
    }))
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the table with name pinned first, Z, raw, _z and the text columns last', async () => {
    renderWithProviders(<PlayerRankings />, { route: '/player-rankings' })
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument())
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(0, 4)).toEqual(['PLAYER', '#', 'Z ▼', 'MPG'])
    expect(headers).toContain('PTS_z')
    expect(headers.slice(-3)).toEqual(['FANTASY', 'TEAM', 'POS'])
    expect(screen.getByRole('link', { name: 'Alpha Guard' })).toHaveAttribute('href', '/player-rankings?player=11')
    expect(screen.getByText(/3 players loaded/)).toBeInTheDocument()
  })

  it('has every filter in the Filters sheet; active ones show as removable chips', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlayerRankings />, { route: '/player-rankings' })
    await waitFor(() => expect(screen.getByText('Beta Wing')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Filters/ }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    for (const group of ['Position', 'Fantasy team', 'Show', 'Min GP', 'Min MPG']) expect(within(sheet).getAllByRole('group', { name: group }).length).toBeGreaterThan(0)
    expect(within(sheet).getByRole('spinbutton', { name: 'Min GP' })).toBeInTheDocument()
    expect(within(sheet).getByRole('spinbutton', { name: 'Min MPG' })).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Free Agents / Waivers' }))
    await user.click(within(sheet).getByRole('button', { name: 'Show results' }))

    await waitFor(() => expect(screen.queryByText('Alpha Guard')).not.toBeInTheDocument())
    expect(screen.getByText('Beta Wing')).toBeInTheDocument()
    // FA keeps its overall rank (#2)
    expect(within(screen.getByText('Beta Wing').closest('tr')!).getAllByRole('cell')[0]).toHaveTextContent('2')

    await user.click(screen.getByRole('button', { name: 'Remove filter Free Agents / Waivers' }))
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument())
  })

  it('punting a category greys its columns and Display mode switches MPG to MIN', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlayerRankings />, { route: '/player-rankings' })
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument())

    const ptsRow = screen.getByRole('slider', { name: 'PTS weight' }).parentElement!
    await user.click(within(ptsRow).getByRole('button', { name: 'punt' }))
    expect(within(ptsRow).getByRole('button', { name: 'PUNT' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByText('PTS_z')).toHaveClass('mr-pr-punted'))

    const display = screen.getByRole('radiogroup', { name: 'Display mode' })
    await user.click(within(display).getByRole('radio', { name: 'Totals' }))
    expect(screen.getByRole('button', { name: 'MIN' })).toBeInTheDocument()
  })

  it('offers Last night and Custom among the period chips', async () => {
    renderWithProviders(<PlayerRankings />, { route: '/player-rankings' })
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument())
    const period = screen.getAllByRole('group', { name: 'Period' })[0]
    expect(within(period).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '📅 Full Season', '🌙 Last night', '🔥 Last 7 Days', '📊 Last 15 Days', '📈 Last 30 Days', '📆 Custom',
    ])
  })

  it('search filters by name and the × clears it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PlayerRankings />, { route: '/player-rankings' })
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument())
    await user.type(screen.getByRole('searchbox', { name: 'Search players' }), 'beta')
    await waitFor(() => expect(screen.queryByText('Alpha Guard')).not.toBeInTheDocument())
    expect(screen.getByText(/1 player found · ranks are overall/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    await waitFor(() => expect(screen.getByText('Alpha Guard')).toBeInTheDocument())
  })
})
