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

function stubApi(myPlayers: unknown[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/nba/with-without/teams')) return Response.json({ teams: [{ team_id: 11, abbr: 'IND', name: 'Indiana Pacers', has_out_today: true }] })
    if (url.includes('/nba/with-without/11')) return Response.json(season)
    if (url.includes('/teams/')) return Response.json([{ team_id: 9, team_name: 'Khachapuri' }])
    if (url.includes('/players')) return Response.json({ players: myPlayers, total_count: myPlayers.length, page: 1, limit: 1200, has_more: false })
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

  it('starts with no team, then compares teammates with and without the picked player', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Pick an NBA team to start')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Team'), '11')

    // Only players who missed games can be picked; out today first.
    expect(await screen.findByText('Who’s sitting out?')).toBeInTheDocument()
    const options = screen.getAllByRole('button', { name: /missed/ })
    expect(options.map(b => b.textContent)).toEqual([
      expect.stringContaining('Tyrese Haliburton'),
      expect.stringContaining('Braden Smith'),
    ])
    expect(options[0]).toHaveTextContent('missed 2')
    expect(options[0]).toHaveTextContent('OUT')
    expect(screen.queryByRole('button', { name: /Andrew Nembhard/ })).not.toBeInTheDocument() // never missed

    await user.click(options[0])
    expect(screen.getByRole('button', { name: 'Remove Tyrese Haliburton' })).toBeInTheDocument()
    expect(screen.getByText('2 without')).toBeInTheDocument()

    // Nembhard has only 2 games without, so he is hidden until asked for.
    expect(screen.getByText(/1 player hidden: fewer than 3 games without/)).toBeInTheDocument()
    expect(screen.queryByText('Andrew Nembhard')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show them' }))

    // with = games 1 & 3 (10, 12 pts), without = 2 & 4 (22, 20 pts).
    expect(screen.getByText('Andrew Nembhard')).toBeInTheDocument()
    expect(screen.getByText('Small sample')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('+10.0')).toBeInTheDocument()
    // Smith only played a "without" game, so he has no row.
    expect(screen.queryByText('Braden Smith')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Show details for Andrew Nembhard' }))
    expect(screen.getByRole('button', { name: 'Hide details for Andrew Nembhard' })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Game-by-game log' }))
    const tabs = within(screen.getByRole('group', { name: 'Which games' }))
    expect(tabs.getByRole('button', { name: 'All games · 4' })).toBeInTheDocument()
    await user.click(tabs.getByRole('button', { name: 'Without · 2' }))
    expect(screen.getAllByText('Without', { selector: 'span' }).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Open in Trade Analyzer' }))
    await waitFor(() => expect(screen.getByTestId('trade-state')).toHaveTextContent('/trade?side=B'))
    expect(screen.getByTestId('trade-state')).toHaveTextContent('"mode":"freeAgent"')
    expect(screen.getByTestId('trade-state')).toHaveTextContent('Andrew Nembhard')
  })

  it('opens on a team with your player and someone out today, with him picked', async () => {
    localStorage.setItem('fw:myTeam.id', '9')
    stubApi([{
      player_id: 50, player_name: 'Pascal Siakam', pro_team: 'IND', positions: ['PF'], team_id: 9, status: 'ONTEAM',
      stats: { pts: 200, reb: 70, ast: 35, stl: 9, blk: 5, three_pm: 12, fgm: 80, fga: 160, ftm: 30, fta: 40, fg_percentage: 0.5, ft_percentage: 0.75, minutes: 330, gp: 10 },
    }])
    renderPage()
    expect(await screen.findByRole('button', { name: 'Remove Tyrese Haliburton' })).toBeInTheDocument()
    expect(screen.getByLabelText('Team', { selector: 'select' })).toHaveValue('11')
    expect(screen.getByText(/Opened on Indiana Pacers: you have players here and Haliburton is out today/)).toBeInTheDocument()
  })
})
