import { act, render, screen, waitFor, within } from '@testing-library/react'
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
const LINE = { pts: 24.3, reb: 8.1, ast: 4, three_pm: 3, stl: 1, blk: 0.5, fgm: 9, fga: 18, fg_pct: 0.5, ftm: 3, fta: 4, ft_pct: 0.75 }
const NEXT = {
  player_name: 'Alpha Star', team: 'LAL', game_date: '2026-11-07', opponent: 'BOS', is_home: true, scheduled: true,
  default_minutes: 31.2, status: 'green', reason: '', stats: LINE,
}

const fetchMock = vi.fn(async (input: Request | string) => {
  const req = typeof input === 'string' ? new Request(input) : input
  const path = new URL(req.url).pathname.replace(/^\/api/, '')
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  if (path.startsWith('/players')) return json(PLAYERS)
  if (path === '/teams/1/players') return json(ROSTER)
  if (path === '/projections/player/7') return json(NEXT)
  if (path === '/projections/predict') {
    const body = await req.json()
    return json({ stats: { ...LINE, pts: body.minutes } })
  }
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

    const tiles = within(within(sheet).getByRole('list', { name: 'Season per game' })).getAllByRole('listitem')
    expect(tiles.map((t) => t.textContent)).toEqual([
      'MPG32.0', 'PTS25.0', 'REB8.0', 'AST4.0', 'STL1.0', 'BLK0.5', '3PM3.0', 'FG%.500', 'FT%.800',
    ])

    const proj = await within(sheet).findByRole('region', { name: 'Next game projection' })
    expect(proj).toHaveTextContent('Next: vs BOS')
    expect(proj).toHaveTextContent('PTS24.3')
    expect(within(proj).getByText(/^31/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Full profile' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Trade Analyzer' })).toBeInTheDocument()
  })

  it('minutes stepper re-asks the model (POST /projections/predict); ↺ goes back to the default', async () => {
    const user = userEvent.setup()
    renderAt('/players?player=7')
    const sheet = await screen.findByRole('dialog', { name: 'Alpha Star' })
    const proj = await within(sheet).findByRole('region', { name: 'Next game projection' })
    await user.click(within(proj).getByRole('button', { name: 'More minutes for Alpha Star' }))
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([r]) => typeof r !== 'string' && r.url.endsWith('/projections/predict'))).toBe(true),
    )
    const predictReq = fetchMock.mock.calls.map(([r]) => r as Request).find((r) => r.url.endsWith('/projections/predict'))!
    expect(predictReq.method).toBe('POST')
    await waitFor(() => expect(proj).toHaveTextContent('PTS32.0'))
    expect(proj).toHaveTextContent('Projected for 32 min · default 31 min')

    await user.click(within(proj).getByRole('button', { name: 'Reset to default minutes for Alpha Star' }))
    expect(proj).toHaveTextContent('PTS24.3')
    expect(proj).toHaveTextContent('Default minutes from the projection model')
  })

  it('free agent: badge, dashes without games, no projection block', async () => {
    renderAt('/players?player=9')
    const sheet = await screen.findByRole('dialog', { name: 'Free Guy' })
    expect(within(sheet).getByText('Free Agent')).toBeInTheDocument()
    expect(within(sheet).getByText('BOS · C · 0 GP')).toBeInTheDocument()
    await waitFor(() => expect(within(sheet).queryByRole('region', { name: 'Next game projection' })).toBeNull())
    expect(within(sheet).getAllByText('—')).toHaveLength(9)
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
