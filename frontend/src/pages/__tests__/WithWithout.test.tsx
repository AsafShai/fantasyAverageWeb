import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes, useLocation } from 'react-router'
import { renderWithProviders } from '../../test/helpers'
import { MyTeamProvider } from '../../context/MyTeamContext'
import type { WithWithoutTeamSeason } from '../../types/withWithout'
import WithWithout from '../WithWithout'

const FIELDS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FGM', 'FGA', 'FTM', 'FTA', 'TO', '3PA', 'OREB', 'DREB', 'PF']
const g = (min: number, pts: number) => [min, pts, 5, 3, 1, 1, 2, 5, 10, 2, 2, 1, 5, 1, 4, 2]

const season: WithWithoutTeamSeason = {
  team_id: 11, abbr: 'IND', name: 'Indiana Pacers', season: '2026-27',
  categories: ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'], reverse_categories: [], line_fields: FIELDS,
  games: ['10-22', '10-24', '10-26', '10-28'].map((d, i) => ({ game_id: `g${i}`, date: `2026-${d}`, opp: 'BOS', home: i % 2 === 0, result: 'W 110-100' })),
  players: [
    { player_id: 1, name: 'Tyrese Haliburton', pos: 'PG', two_way: false, approx: false, out_today: { status: 'Out', note: 'Left Hamstring Strain' }, owner: { team_id: 9, abbrev: 'KHA', name: 'Khachapuri' }, lines: [g(34, 20), 0, g(33, 18), 0] },
    { player_id: 2, name: 'Andrew Nembhard', pos: 'PG', two_way: false, approx: false, out_today: null, owner: null, lines: [g(28, 10), g(36, 22), g(27, 12), g(35, 20)] },
    { player_id: 3, name: 'Braden Smith', pos: 'G', two_way: true, approx: false, out_today: null, owner: null, lines: [0, g(12, 4), 0, 0] },
  ],
}

function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/nba/with-without/teams')) return Response.json({ teams: [{ team_id: 11, abbr: 'IND', name: 'Indiana Pacers', has_out_today: true }] })
    if (url.includes('/nba/with-without/11')) return Response.json(season)
    if (url.includes('/teams/')) return Response.json([{ team_id: 9, team_name: 'Khachapuri' }])
    if (url.includes('/players')) return Response.json({ players: [], total_count: 0, page: 1, limit: 1200, has_more: false })
    return new Response('not found', { status: 404 })
  }))
}

function TradeStateProbe() {
  const loc = useLocation()
  return <pre data-testid="trade-state">{loc.pathname + loc.search} {JSON.stringify(loc.state)}</pre>
}

function renderPage() {
  return renderWithProviders(
    <MyTeamProvider>
      <Routes>
        <Route path="/with-without" element={<WithWithout />} />
        <Route path="/trade" element={<TradeStateProbe />} />
      </Routes>
    </MyTeamProvider>,
    { route: '/with-without' },
  )
}

describe('With / Without page', () => {
  beforeEach(() => { localStorage.clear(); stubApi() })
  afterEach(() => vi.unstubAllGlobals())

  it('lists who missed games, then compares teammates with and without the picked player', async () => {
    const user = userEvent.setup()
    renderPage()
    const pick = await screen.findByRole('button', { name: /Tyrese Haliburton/ })
    expect(pick).toHaveTextContent('missed 2 of 4')
    expect(pick).toHaveTextContent('OUT · Left Hamstring Strain')
    expect(screen.getByRole('button', { name: /Braden Smith/ })).toHaveTextContent('Two-way')
    expect(screen.getByRole('button', { name: /Andrew Nembhard/ })).toBeDisabled() // never missed
    expect(screen.getByText(/Tick at least one IND player/)).toBeInTheDocument()

    await user.click(pick)
    expect(await screen.findByText(/the 2 where Haliburton sat, and the 2 where he played/)).toBeInTheDocument()

    // Nembhard: with = games 1 & 3 (10, 12 pts), without = 2 & 4 (22, 20 pts).
    const row = screen.getByRole('button', { name: /Andrew Nembhard/, expanded: false })
    expect(within(row).getByText('2 · 2')).toBeInTheDocument()
    expect(within(row).getByText('+10.0')).toBeInTheDocument()
    // Smith only played a "without" game, so he has no row.
    expect(screen.queryByRole('button', { name: /Braden Smith/, expanded: false })).not.toBeInTheDocument()

    await user.click(row)
    expect(screen.getByText(/per game, with vs. without Haliburton/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open in Trade Analyzer' }))
    await waitFor(() => expect(screen.getByTestId('trade-state')).toHaveTextContent('/trade?side=B'))
    expect(screen.getByTestId('trade-state')).toHaveTextContent('"mode":"freeAgent"')
    expect(screen.getByTestId('trade-state')).toHaveTextContent('Andrew Nembhard')
  })
})
