import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Player } from '../../types/api'
import { renderWithProviders } from '../../test/helpers'
import ShootingMap from '../ShootingMap'

let nextId = 1
function player(name: string, team: string, fgm: number, fga: number, teamId = 0): Player {
  const gp = 5
  return {
    player_name: name,
    pro_team: team,
    positions: ['SG'],
    player_id: nextId++,
    stats: {
      pts: 20 * gp, reb: 5 * gp, ast: 5 * gp, stl: gp, blk: gp, three_pm: 2 * gp,
      fg_percentage: fgm / fga, ft_percentage: 0.8,
      fgm: fgm * gp, fga: fga * gp, ftm: 4 * gp, fta: 5 * gp,
      minutes: 30 * gp, gp,
    },
    team_id: teamId,
    status: 'FREEAGENT',
  }
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('ShootingMap page', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/players/')) {
        return jsonResponse({
          players: [player('Sharp Center', 'BOS', 9, 12, 7), player('Brick Guard', 'BOS', 6, 18), player('Laker Wing', 'LAL', 8, 14)],
          total_count: 3, page: 1, limit: 1200, has_more: false, actual_start: '2026-10-20', actual_end: '2026-11-06',
        })
      }
      if (url.includes('/teams/')) return jsonResponse([{ team_id: 7, team_name: 'Roy Team' }, { team_id: 8, team_name: 'Other Team' }])
      return new Response('not found', { status: 404 })
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists who helps and hurts FG%, and narrows the lists to one NBA team', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    const helps = await screen.findByRole('heading', { name: 'Best for FG%' })
    const helpList = helps.parentElement!
    await waitFor(() => expect(within(helpList).getByText('Sharp Center')).toBeInTheDocument())
    expect(screen.getByText(/Through Nov 6/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('NBA team'), 'LAL')
    const lalHelps = await screen.findByRole('heading', { name: 'Best for FG% · LAL' })
    expect(within(lalHelps.parentElement!).getByText('Laker Wing')).toBeInTheDocument()
    expect(within(lalHelps.parentElement!).queryByText('Sharp Center')).not.toBeInTheDocument()
  })

  it('narrows to a fantasy team, and to free agents', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await waitFor(() => expect(screen.getByRole('option', { name: 'Roy Team' })).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('Fantasy team'), 'Roy Team')
    const roy = await screen.findByRole('heading', { name: 'Best for FG% · Roy Team' })
    expect(within(roy.parentElement!).getByText('Sharp Center')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Fantasy team'), 'Free agents / waivers')
    const fa = await screen.findByRole('heading', { name: 'Worst for FG% · Free agents' })
    expect(within(fa.parentElement!).getByText('Brick Guard')).toBeInTheDocument()
  })

  it('combines the NBA and fantasy team from the link', async () => {
    renderWithProviders(<ShootingMap />, { route: '/scatter-map?team=BOS&fteam=fa' })
    expect(await screen.findByRole('heading', { name: 'Worst for FG% · BOS · Free agents' })).toBeInTheDocument()
  })

  it('hides players under the minimum games', async () => {
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    expect(screen.getByLabelText('Min games')).toHaveValue('2')
    fireEvent.change(screen.getByLabelText('Min games'), { target: { value: '6' } })
    // every fixture player has 5 games
    expect(await screen.findByText('No players with at least 6 games in this period yet.')).toBeInTheDocument()
  })

  it('narrows the lists with the % and attempts thresholds, and clears them', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    const best = (await screen.findByRole('heading', { name: 'Best for FG%' })).parentElement!
    await waitFor(() => expect(within(best).getByText('Sharp Center')).toBeInTheDocument())

    // Sharp Center takes 12 FGA a game, Brick Guard 18
    await user.type(screen.getByLabelText('Minimum FGA per game'), '15')
    expect(within(best).queryByText('Sharp Center')).not.toBeInTheDocument()
    const worst = screen.getByRole('heading', { name: 'Worst for FG%' }).parentElement!
    expect(within(worst).getByText('Brick Guard')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Minimum FGA per game')).toHaveValue(null)
    expect(within(best).getByText('Sharp Center')).toBeInTheDocument()
  })

  it('ignores an unknown team in the link', async () => {
    renderWithProviders(<ShootingMap />, { route: '/scatter-map?team=xyz' })
    expect(await screen.findByRole('heading', { name: 'Best for FG%' })).toBeInTheDocument()
  })

  it('reads a lowercase team from the link', async () => {
    renderWithProviders(<ShootingMap />, { route: '/scatter-map?team=lal' })
    expect(await screen.findByRole('heading', { name: 'Best for FG% · LAL' })).toBeInTheDocument()
    expect(screen.getByLabelText('NBA team')).toHaveValue('LAL')
  })

  it('says so when the search finds nobody', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.type(screen.getByLabelText('Find a player'), 'zzz{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('No player found')
  })

  it('pins a player found by search', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.type(screen.getByLabelText('Find a player'), 'brick{Enter}')
    const pinned = screen.getByRole('heading', { name: 'Pinned players' }).parentElement!
    expect(within(pinned).getByText('Brick Guard')).toBeInTheDocument()
    await user.click(within(pinned).getByRole('button', { name: 'Remove Brick Guard' }))
    expect(within(pinned).queryByText('Brick Guard')).not.toBeInTheDocument()
  })

  it('opens with FG% × FGA and picks another shooting chart from the menu', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    const shooting = screen.getByRole('button', { name: /^Shooting: FG% × FGA/ })
    expect(shooting).toHaveAttribute('aria-pressed', 'true')
    // the axis pickers belong to Custom
    expect(screen.queryByRole('group', { name: 'X axis' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(shooting)
    const menu = screen.getByRole('menu', { name: 'Shooting' })
    expect(within(menu).getAllByRole('menuitemradio').map(b => b.textContent)).toEqual(['FG% × FGA', 'FT% × FTA', 'TS% × Points'])
    await user.click(within(menu).getByRole('menuitemradio', { name: 'TS% × Points' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Most efficient scorers' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Shooting: TS% × Points/ })).toBeInTheDocument()
    expect(screen.getByText(/points above or below an average scorer on the same shots/)).toBeInTheDocument()
  })

  it('closes a menu with Escape without changing the chart', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.click(screen.getByRole('button', { name: /^Per minute/ }))
    expect(within(screen.getByRole('menu', { name: 'Per minute' })).getAllByRole('menuitemradio')).toHaveLength(6)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Best for FG%' })).toBeInTheDocument()
  })

  it('charts a stat per minute, with a minutes floor and no units', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    expect(screen.getByRole('group', { name: 'Units' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Min minutes per game')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Per minute/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'Rebounds' }))
    expect(await screen.findByRole('heading', { name: 'Best REB per minute' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Per minute: Rebounds/ })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Units' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Min minutes per game')).toHaveValue('10')
    expect(screen.getByLabelText('Minimum MIN per game')).toBeInTheDocument()

    // every fixture player plays 30 minutes a game
    fireEvent.change(screen.getByLabelText('Min minutes per game'), { target: { value: '30' } })
    expect(screen.getByRole('heading', { name: 'Best REB per minute' })).toBeInTheDocument()
  })

  it('picks any two stats in Custom, swaps them, and comes back to them', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.click(screen.getByRole('button', { name: 'Custom' }))
    expect(await screen.findByRole('heading', { name: 'Best STL + BLK' })).toBeInTheDocument()
    const x = screen.getByRole('group', { name: 'X axis' }), y = screen.getByRole('group', { name: 'Y axis' })
    expect(within(x).getAllByRole('button')).toHaveLength(14)
    expect(within(x).getByRole('button', { name: 'STL' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/average of the two z-scores \(greener/)).toBeInTheDocument()

    // volume on one axis: the other stat alone colors the dots
    await user.click(within(y).getByRole('button', { name: 'FGA' }))
    expect(await screen.findByRole('heading', { name: 'Highest STL' })).toBeInTheDocument()
    expect(screen.getByText(/STL only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Above avg combined' })).not.toBeInTheDocument()

    // picking the stat the other axis shows swaps the two
    await user.click(within(x).getByRole('button', { name: 'FGA' }))
    expect(within(y).getByRole('button', { name: 'STL' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Swap axes' }))
    expect(within(x).getByRole('button', { name: 'STL' })).toHaveAttribute('aria-pressed', 'true')

    // minutes on an axis brings the minutes floor
    await user.click(within(y).getByRole('button', { name: 'MIN' }))
    expect(await screen.findByRole('heading', { name: 'Best STL per minute' })).toBeInTheDocument()
    expect(screen.getByLabelText('Min minutes per game')).toBeInTheDocument()

    // each analysis remembers its last chart
    await user.click(screen.getByRole('button', { name: 'Points × Assists' }))
    await user.click(screen.getByRole('button', { name: /^Shooting/ }))
    await user.click(screen.getByRole('menuitemradio', { name: 'FT% × FTA' }))
    expect(await screen.findByRole('heading', { name: 'Best for FT%' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'X axis' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Custom' }))
    expect(await screen.findByRole('heading', { name: 'Best PTS + AST' })).toBeInTheDocument()
  })

  it('charts the shooting impact as a stat of its own', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.click(screen.getByRole('button', { name: 'Custom' }))
    await user.click(within(screen.getByRole('group', { name: 'X axis' })).getByRole('button', { name: 'FG Imp' }))
    await user.click(within(screen.getByRole('group', { name: 'Y axis' })).getByRole('button', { name: 'FGA' }))
    const best = (await screen.findByRole('heading', { name: 'Highest FG Imp' })).parentElement!
    // Sharp Center: 9 of 12 against a pool that makes 23 of 44
    expect(within(best).getByText('Sharp Center')).toBeInTheDocument()
    expect(within(best).getByText(/\+2\.7 FG Imp \(#1\) · 12\.0 FGA/)).toBeInTheDocument()
  })

  it('narrows the lists to the picked positions, any of several', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    const best = (await screen.findByRole('heading', { name: 'Best for FG%' })).parentElement!
    await waitFor(() => expect(within(best).getByText('Sharp Center')).toBeInTheDocument())
    const positions = screen.getByRole('group', { name: 'Positions' })
    // every fixture player is a SG
    await user.click(within(positions).getByRole('button', { name: 'C' }))
    expect(within(best).queryByText('Sharp Center')).not.toBeInTheDocument()
    await user.click(within(positions).getByRole('button', { name: 'SG' }))
    expect(within(best).getByText('Sharp Center')).toBeInTheDocument()
    await user.click(within(positions).getByRole('button', { name: 'C' }))
    await user.click(within(positions).getByRole('button', { name: 'SG' }))
    expect(within(best).getByText('Sharp Center')).toBeInTheDocument()
  })

  it('falls back to the default chart when the stored one no longer exists', async () => {
    localStorage.setItem('fw:shootingMap.chart', JSON.stringify('custom'))
    localStorage.setItem('fw:shootingMap.pairs', JSON.stringify({ custom: ['STL', 'NOPE'] }))
    renderWithProviders(<ShootingMap />, { route: '/scatter-map' })
    expect(await screen.findByRole('heading', { name: 'Best STL + BLK' })).toBeInTheDocument()
  })
})
