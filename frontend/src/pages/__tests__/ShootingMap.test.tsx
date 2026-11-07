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
    renderWithProviders(<ShootingMap />, { route: '/shooting-map' })
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
    renderWithProviders(<ShootingMap />, { route: '/shooting-map' })
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
    renderWithProviders(<ShootingMap />, { route: '/shooting-map?team=BOS&fteam=fa' })
    expect(await screen.findByRole('heading', { name: 'Worst for FG% · BOS · Free agents' })).toBeInTheDocument()
  })

  it('hides players under the minimum games', async () => {
    renderWithProviders(<ShootingMap />, { route: '/shooting-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    expect(screen.getByLabelText('Min games')).toHaveValue(2)
    fireEvent.change(screen.getByLabelText('Min games'), { target: { value: '6' } })
    // every fixture player has 5 games
    expect(await screen.findByText('No players with at least 6 games in this period yet.')).toBeInTheDocument()
  })

  it('ignores an unknown team in the link', async () => {
    renderWithProviders(<ShootingMap />, { route: '/shooting-map?team=xyz' })
    expect(await screen.findByRole('heading', { name: 'Best for FG%' })).toBeInTheDocument()
  })

  it('reads a lowercase team from the link', async () => {
    renderWithProviders(<ShootingMap />, { route: '/shooting-map?team=lal' })
    expect(await screen.findByRole('heading', { name: 'Best for FG% · LAL' })).toBeInTheDocument()
    expect(screen.getByLabelText('NBA team')).toHaveValue('LAL')
  })

  it('says so when the search finds nobody', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/shooting-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.type(screen.getByLabelText('Find a player'), 'zzz{Enter}')
    expect(screen.getByRole('status')).toHaveTextContent('No player found')
  })

  it('pins a player found by search', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ShootingMap />, { route: '/shooting-map' })
    await screen.findByRole('heading', { name: 'Best for FG%' })
    await user.type(screen.getByLabelText('Find a player'), 'brick{Enter}')
    const pinned = screen.getByRole('heading', { name: 'Pinned players' }).parentElement!
    expect(within(pinned).getByText('Brick Guard')).toBeInTheDocument()
    await user.click(within(pinned).getByRole('button', { name: 'Remove Brick Guard' }))
    expect(within(pinned).queryByText('Brick Guard')).not.toBeInTheDocument()
  })
})
