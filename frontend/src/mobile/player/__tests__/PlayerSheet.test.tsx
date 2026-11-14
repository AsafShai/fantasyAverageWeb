import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlayerNameLink from '../../../components/PlayerNameLink'
import { createTestStore } from '../../../test/helpers'
import PlayerSheet from '../PlayerSheet'
import { playerFromSearch, playerIdFromPath, searchWithPlayer, searchWithoutPlayer } from '../playerParam'

let mobile = true
vi.mock('../../flag', () => ({ useMobileRedesign: () => mobile }))

const PLAYERS = {
  players: [
    {
      player_name: 'Alpha Star', player_id: 7, pro_team: 'LAL', positions: ['PG', 'SG'], team_id: 1, status: 'ONTEAM',
      fantasy_team_name: 'Trust the process',
      stats: { pts: 250, reb: 80, ast: 40, stl: 10, blk: 5, fgm: 100, fga: 200, ftm: 40, fta: 50, fg_percentage: 0.5, ft_percentage: 0.8, three_pm: 30, minutes: 320, gp: 10 },
    },
    {
      player_name: 'Free Guy', player_id: 9, pro_team: 'BOS', positions: ['C'], team_id: 0, status: 'FREEAGENT',
      stats: { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, fg_percentage: 0, ft_percentage: 0, three_pm: 0, minutes: 0, gp: 0 },
    },
  ],
  total_count: 2, page: 1, limit: 1200, has_more: false,
}
const ROSTER = { team_id: 1, last_updated: '', players: [{ ...PLAYERS.players[0], lineup_slot: 'BE' }] }
const fetchMock = vi.fn(async (input: Request | string) => {
  const req = typeof input === 'string' ? new Request(input) : input
  const path = new URL(req.url).pathname.replace(/^\/api/, '')
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  if (path.startsWith('/players')) {
    const period = new URL(req.url).searchParams.get('time_period')
    if (period === 'last_7') {
      // Alpha played 2 games (60 pts); Free Guy none in the window.
      const alpha = { ...PLAYERS.players[0], stats: { ...PLAYERS.players[0].stats, pts: 60, minutes: 70, gp: 2 } }
      // Hot Hand (SG) out-plays everyone over the window, so Alpha drops to #2.
      const hot = {
        ...PLAYERS.players[1], player_name: 'Hot Hand', player_id: 11, positions: ['SG'],
        stats: { pts: 120, reb: 100, ast: 60, stl: 14, blk: 8, fgm: 48, fga: 80, ftm: 18, fta: 20, fg_percentage: 0.6, ft_percentage: 0.9, three_pm: 40, minutes: 72, gp: 2 },
      }
      return json({ ...PLAYERS, players: [alpha, hot, { ...PLAYERS.players[1], has_data: false }] })
    }
    return json(PLAYERS)
  }
  if (path === '/teams/1/players') return json(ROSTER)
  return new Response(JSON.stringify({ detail: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
})

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + loc.search}</p>
}

function Page() {
  return (
    <>
      <Where />
      <PlayerNameLink name="Alpha Star" playerId={7} />
      <PlayerNameLink name="Free Guy" playerId={9} />
      <PlayerSheet />
    </>
  )
}

function renderAt(route: string) {
  return render(
    <Provider store={createTestStore()}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="*" element={<Page />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  )
}

beforeEach(() => {
  mobile = true
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('playerParam', () => {
  it('adds, reads and removes ?player= keeping other params', () => {
    expect(searchWithPlayer('?date=2026-11-06', '7')).toBe('?date=2026-11-06&player=7')
    expect(playerFromSearch('?date=1&player=7')).toBe('7')
    expect(searchWithoutPlayer('?date=1&player=7')).toBe('?date=1')
    expect(searchWithoutPlayer('?player=7')).toBe('')
    expect(playerIdFromPath('/player/4066261')).toBe('4066261')
    expect(playerIdFromPath('/players')).toBeNull()
  })
})

describe('player sheet', () => {
  it('desktop: names still link to the profile page', () => {
    mobile = false
    renderAt('/players')
    expect(screen.getByRole('link', { name: 'Alpha Star' })).toHaveAttribute('href', '/player/7')
  })

  it('phone: a name opens the sheet as ?player= over the same page', async () => {
    const user = userEvent.setup()
    renderAt('/teams?x=1')
    expect(screen.getByRole('link', { name: 'Alpha Star' })).toHaveAttribute('href', '/teams?x=1&player=7')
    await user.click(screen.getByRole('link', { name: 'Alpha Star' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/teams?x=1&player=7')

    const sheet = await screen.findByRole('dialog', { name: 'Alpha Star' })
    expect(within(sheet).getByRole('heading', { name: 'Alpha Star' })).toBeInTheDocument()
    // NBA team · positions · slot · GP, once the roster gives the slot
    await within(sheet).findByText('LAL · PG/SG · Bench · 10 GP')
    expect(within(sheet).getByRole('link', { name: 'Trust the process' })).toHaveAttribute('href', '/team/1')

    const tiles = within(within(sheet).getByRole('list', { name: 'Per game' })).getAllByRole('listitem')
    expect(tiles.map((t) => t.textContent)).toEqual([
      'MPG32.0', 'PTS25.0', 'REB8.0', 'AST4.0', 'STL1.0', 'BLK0.5', '3PM3.0', 'FG%.500', 'FT%.800',
    ])

    // No projection in the sheet (it stays on the full profile), and none is fetched.
    expect(within(sheet).queryByRole('region', { name: 'Next game projection' })).toBeNull()
    expect(fetchMock.mock.calls.some(([r]) => typeof r !== 'string' && r.url.includes('/projections/'))).toBe(false)
    expect(within(sheet).getByRole('button', { name: 'Full profile' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Preview trade' })).toBeInTheDocument()
  })

  it('free agent: badge, dashes without games', async () => {
    renderAt('/players?player=9')
    const sheet = await screen.findByRole('dialog', { name: 'Free Guy' })
    expect(within(sheet).getByText('Free Agent')).toBeInTheDocument()
    expect(within(sheet).getByText('BOS · C · 0 GP')).toBeInTheDocument()
    expect(within(sheet).getAllByText('—')).toHaveLength(9)
  })

  it('period chips (shared PeriodChips) switch the per-game grid', async () => {
    const user = userEvent.setup()
    renderAt('/players?player=7')
    const sheet = await screen.findByRole('dialog', { name: 'Alpha Star' })
    const chips = within(within(sheet).getByRole('group', { name: 'Period' })).getAllByRole('button')
    expect(chips.map((c) => c.textContent)).toEqual(['📅 Full Season', '🔥 Last 7 Days', '📊 Last 15 Days', '📈 Last 30 Days', '📆 Custom'])
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(within(sheet).getByText('SEASON · PER GAME')).toBeInTheDocument()
    expect(within(sheet).getByTestId('sheet-rank')).toHaveTextContent('#1 of')
    expect(within(sheet).getByText('#1 PG · #1 SG')).toBeInTheDocument()
    const seasonZ = within(sheet).getByTestId('sheet-z').textContent
    expect(seasonZ).toMatch(/^[+-]\d\.\d\d$/)

    await user.click(chips[1])
    await within(sheet).findByText('LAST 7 DAYS · PER GAME · 2 GP')
    const tiles = within(within(sheet).getByRole('list', { name: 'Per game' })).getAllByRole('listitem')
    expect(tiles.slice(0, 2).map((t) => t.textContent)).toEqual(['MPG35.0', 'PTS30.0'])
    // rank follows the period too
    await within(sheet).findByText('#1 PG · #2 SG')
    expect(within(sheet).getByTestId('sheet-rank')).toHaveTextContent('#2 of')
    expect(within(sheet).getByTestId('sheet-z').textContent).not.toBe(seasonZ)
    // the header line stays the season's
    expect(within(sheet).getByText('LAL · PG/SG · Bench · 10 GP')).toBeInTheDocument()
  })

  it('a period with no games says so', async () => {
    const user = userEvent.setup()
    renderAt('/players?player=9')
    const sheet = await screen.findByRole('dialog', { name: 'Free Guy' })
    await user.click(within(sheet).getByRole('button', { name: /Last 7 Days/ }))
    await within(sheet).findByText('No games in this period.')
  })

  it('closing (Escape, opened from a shared link) drops ?player= and keeps the page', async () => {
    const user = userEvent.setup()
    renderAt('/box-scores?date=2026-11-06&player=7')
    await screen.findByRole('dialog', { name: 'Alpha Star' })
    await act(async () => {
      await user.keyboard('{Escape}')
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('where')).toHaveTextContent('/box-scores?date=2026-11-06')
  })
})
