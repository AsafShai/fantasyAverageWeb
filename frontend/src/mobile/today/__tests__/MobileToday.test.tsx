import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TodayHub } from '../../../types/api'
import type { LatestMoves } from '../../../types/activity'
import { renderWithProviders } from '../../../test/helpers'
import Today from '../../../pages/Today'
import { LatestMovesCard } from '../LatestMovesCard'
import { groupMovers } from '../groupMovers'

let mobile = true
vi.mock('../../flag', () => ({ useMobileRedesign: () => mobile }))

const summary = {
  total_teams: 12,
  total_games_played: 400,
  nba_avg_pace: 99.4,
  nba_game_days_left: 120,
  category_leaders: {},
  league_averages: {
    gp: 3.5, fg_percentage: 0.471, ft_percentage: 0.782, three_pm: 12.3, ast: 24.1,
    reb: 43.2, stl: 7.4, blk: 4.6, pts: 112.7,
  },
  last_updated: '2026-09-18T09:41:00Z',
  trade_deadline: null as string | null,
}

const rankings = {
  averages_rankings: [
    { team: { team_id: 1, team_name: '50 Shades of Shai' }, total_points: 80.5 },
    { team: { team_id: 2, team_name: "Khachapuri's Team" }, total_points: 74 },
    { team: { team_id: 3, team_name: 'DORELIT' }, total_points: 70 },
  ],
  totals_rankings: [],
  categories: [],
  last_updated: '2026-09-18T09:41:00Z',
}

const rankChanges = {
  previous_period: 1,
  latest_period: 2,
  teams: [
    { team_id: 1, team_name: '50 Shades of Shai', rank_delta: 0, total_delta: 2, gp_delta: 3, categories: {} },
    { team_id: 2, team_name: "Khachapuri's Team", rank_delta: -1, total_delta: -6, gp_delta: 2, categories: {} },
    { team_id: 3, team_name: 'DORELIT', rank_delta: 0, total_delta: 0, gp_delta: 2, categories: {} },
  ],
}

const hub: TodayHub = {
  slate_date: '2026-09-18',
  games_count: 8,
  movers: [
    { team_id: 2, team_name: "Khachapuri's Team", category: 'TOTAL', delta: -6 },
    { team_id: 2, team_name: "Khachapuri's Team", category: 'STL', delta: -3 },
    { team_id: 2, team_name: "Khachapuri's Team", category: '3PM', delta: -2 },
    { team_id: 5, team_name: "Oriel's Team", category: 'TOTAL', delta: 5 },
    { team_id: 5, team_name: "Oriel's Team", category: 'FT%', delta: 2 },
    { team_id: 7, team_name: 'Small Mover', category: 'AST', delta: 1.5 },
  ],
  roster_health: [
    { team_id: 3, team_name: "Amihai's Awesome", games_tonight: 11, available_tonight: 4, probable: 1, questionable: 2, doubtful: 1, out: 3 },
    { team_id: 1, team_name: '50 Shades of Shai', games_tonight: 7, available_tonight: 6, probable: 0, questionable: 1, doubtful: 0, out: 0 },
  ],
  last_nightly: { game_date: '2026-09-17', rows: 240 },
}

const latest: LatestMoves = {
  teams: [
    { team_id: 1, name: '50 Shades of Shai', abbrev: 'SHAI' },
    { team_id: 2, name: "Khachapuri's Team", abbrev: 'KHA' },
  ],
  moves: [
    { id: 'm1', kind: 'waiver', at: '2026-11-06T10:00:00Z', team_id: 1, other_team_id: null, trade_id: null, added: [{ player_id: 11, name: 'Jakob Poeltl' }], dropped: [{ player_id: 12, name: 'Brayden Burries' }] },
    { id: 'm2', kind: 'trade', at: '2026-11-05T10:00:00Z', team_id: 1, other_team_id: 2, trade_id: 't1', added: [{ player_id: 13, name: 'Player A' }], dropped: [{ player_id: 14, name: 'Player B' }] },
  ],
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
const urlOf = (i: RequestInfo | URL) => (typeof i === 'string' ? i : i instanceof URL ? i.href : (i as Request).url)

function stubApi(overrides: Partial<{ hub: TodayHub; summary: typeof summary }> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = urlOf(input)
      if (url.includes('/league/today')) return json(overrides.hub ?? hub)
      if (url.includes('/league/summary')) return json(overrides.summary ?? summary)
      if (url.includes('/league/rank-changes')) return json(rankChanges)
      if (url.includes('/league/activity/latest')) return json(latest)
      if (url.includes('/rankings')) return json(rankings)
      return new Response('not found', { status: 404 })
    }),
  )
}

beforeEach(() => {
  mobile = true
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('groupMovers', () => {
  it('groups per team: TOTAL as the number, categories biggest first, biggest move first', () => {
    const groups = groupMovers(hub.movers, null)
    expect(groups.map((g) => g.team_name)).toEqual(["Khachapuri's Team", "Oriel's Team", 'Small Mover'])
    expect(groups[0]).toMatchObject({ total: -6, parts: [{ category: 'STL', delta: -3 }, { category: '3PM', delta: -2 }] })
    expect(groups[2].total).toBeNull()
  })

  it('puts my team first', () => {
    expect(groupMovers(hub.movers, 7)[0].team_id).toBe(7)
  })
})

describe('Today page on a phone (redesign on)', () => {
  it('renders the redesigned cards in the design order', async () => {
    stubApi()
    renderWithProviders(<Today />)
    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument())

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Today', 'Top 5 Teams (average)', 'Rank movers', 'Roster health today', 'League averages'])
    expect(screen.getByRole('link', { name: /Fri, Sep 18 · 8 games/ })).toHaveAttribute('href', '/box-scores')
  })

  it('Top 5: points with the change since yesterday, and Full standings', async () => {
    stubApi()
    renderWithProviders(<Today />)
    const card = await screen.findByRole('region', { name: 'Top 5 Teams (average)' })
    await waitFor(() => expect(within(card).getByText('▼6')).toBeInTheDocument())
    expect(within(card).getByText('▲2')).toBeInTheDocument()
    expect(within(card).getByText('80.5')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Full standings' })).toHaveAttribute('href', '/rankings?view=standings')
  })

  it('rank movers grouped per team, filterable by team in a sheet', async () => {
    stubApi()
    renderWithProviders(<Today />)
    const list = await screen.findByRole('list', { name: 'Rank movers by team' })
    expect(within(list).getByText('STL −3 · 3PM −2')).toBeInTheDocument()
    expect(within(list).getByText('▲5')).toBeInTheDocument()
    expect(within(list).getByText('AST +1.5')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Filter teams: All teams' }))
    const sheet = await screen.findByRole('dialog', { name: 'Teams' })
    await userEvent.click(within(sheet).getByLabelText("Oriel's Team"))
    expect(screen.getByRole('button', { name: "Filter teams: Oriel's Team" })).toBeInTheDocument()
    const filtered = screen.getByRole('list', { name: 'Rank movers by team' })
    expect(within(filtered).queryByText("Khachapuri's Team")).not.toBeInTheDocument()
    expect(within(filtered).getByText("Oriel's Team")).toBeInTheDocument()
  })

  it('roster health: tiles, colored counts, sortable columns', async () => {
    stubApi()
    renderWithProviders(<Today />)
    const table = await screen.findByRole('table', { name: 'Roster health today' })
    expect(screen.getByText('NBA games')).toBeInTheDocument()
    expect(screen.getByText('16')).toBeInTheDocument() // teams playing
    expect(screen.getByText('Out tonight')).toBeInTheDocument()

    const firstTeam = () => within(table).getAllByRole('row')[1].textContent
    expect(firstTeam()).toMatch(/^Amihai/)
    await userEvent.click(within(table).getByRole('button', { name: 'Out' }))
    await userEvent.click(within(table).getByRole('button', { name: 'Out' }))
    expect(firstTeam()).toMatch(/^50 Shades/)
    expect(screen.getByText('Slate 2026-09-18')).toBeInTheDocument()
  })

  it('league averages: nine stats plus pace, days left and teams, linking to Standings', async () => {
    stubApi()
    renderWithProviders(<Today />)
    await waitFor(() => expect(screen.getByText('112.70')).toBeInTheDocument())
    for (const label of ['FG%', 'FT%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS', 'GP', 'NBA pace', 'Days left', 'Teams']) {
      expect(screen.getByText(label, { selector: 'dt' })).toBeInTheDocument()
    }
    expect(screen.getByText('per team, season to date')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Compare teams in Standings' })).toHaveAttribute('href', '/rankings?view=standings&mode=averages')
  })

  it('trade deadline card only in the last 7 days', async () => {
    stubApi({ summary: { ...summary, trade_deadline: new Date(Date.now() + 3 * 86400_000).toISOString() } })
    renderWithProviders(<Today />)
    expect(await screen.findByText('Trade Deadline')).toBeInTheDocument()
    expect(screen.getByRole('timer').getAttribute('aria-label')).toMatch(/^[23] Days/)
  })

  it('no deadline card when it is more than 7 days away', async () => {
    stubApi({ summary: { ...summary, trade_deadline: new Date(Date.now() + 30 * 86400_000).toISOString() } })
    renderWithProviders(<Today />)
    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument())
    expect(screen.queryByText('Trade Deadline')).not.toBeInTheDocument()
  })

  it('empty states', async () => {
    stubApi({ hub: { slate_date: null, games_count: 0, movers: [], roster_health: [], last_nightly: null } })
    renderWithProviders(<Today />)
    expect(await screen.findByText('Movers appear after the second scoring period.')).toBeInTheDocument()
    expect(screen.getByText('No NBA games scheduled.')).toBeInTheDocument()
    expect(screen.getByText(/Injury report unavailable/)).toBeInTheDocument()
  })

  it('desktop (redesign off) keeps the old page', async () => {
    mobile = false
    stubApi()
    renderWithProviders(<Today />)
    await waitFor(() => expect(screen.getByText('Rank movers')).toBeInTheDocument())
    expect(screen.queryByRole('list', { name: 'Rank movers by team' })).not.toBeInTheDocument()
    expect(screen.getAllByText('TOTAL').length).toBeGreaterThan(0)
  })
})

describe('Latest moves card (phone)', () => {
  it('team abbreviation, kind badge, added and dropped players, trades as "X got …"', async () => {
    stubApi()
    renderWithProviders(<LatestMovesCard />)
    expect(await screen.findByText('Waiver claim')).toBeInTheDocument()
    expect(screen.getByText('Jakob Poeltl')).toBeInTheDocument()
    expect(screen.getByText('Brayden Burries')).toBeInTheDocument()
    expect(screen.getByText('SHAI ⇄ KHA')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trade' })).toHaveAttribute('href', '/activity?tab=trades&trade=t1')
    expect(screen.getByRole('link', { name: 'All activity →' })).toHaveAttribute('href', '/activity')
  })
})
