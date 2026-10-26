import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import BoxScores from '../BoxScores'

const board = {
  date: '2026-10-25',
  games: [
    {
      game_id: '100',
      status: 'final',
      status_detail: 'Final',
      start_time: '2026-10-26T02:00:00Z',
      broadcast: 'ESPN',
      venue: 'Delta Center',
      away: {
        team_id: '13', name: 'Los Angeles Lakers', short_name: 'Lakers', abbreviation: 'LAL',
        logo: '', color: '552583', record: '3-1', score: 129, winner: true,
      },
      home: {
        team_id: '26', name: 'Utah Jazz', short_name: 'Jazz', abbreviation: 'UTAH',
        logo: '', color: '002B5C', record: '1-3', score: 117, winner: false,
      },
    },
  ],
}

const box = {
  game_id: '100',
  status: 'final',
  status_detail: 'Final',
  start_time: '2026-10-26T02:00:00Z',
  broadcast: 'ESPN',
  venue: 'Delta Center',
  periods: ['1', '2', '3', '4'],
  away: {
    ...board.games[0].away,
    linescores: ['30', '40', '29', '30'],
    starters: [{
      player_id: '1', name: 'Austin Reaves', position: 'G', ejected: false,
      min: '34', pts: '28', fg: '10-18', fg3: '3-7', ft: '5-5', reb: '4', ast: '6',
      tov: '2', stl: '1', blk: '0', oreb: '1', dreb: '3', pf: '2', plus_minus: '+12',
    }],
    bench: [],
    did_not_play: [{ player_id: '9', name: 'Sit Out', position: 'F', reason: "Coach's Decision" }],
    totals: {
      min: '240', pts: '129', fg: '48-90', fg3: '12-30', ft: '21-24', reb: '45', ast: '28',
      tov: '12', stl: '8', blk: '4', oreb: '10', dreb: '35', pf: '18', plus_minus: '',
    },
    shooting: {
      fg_pct: '53.3', fg3_pct: '40.0', ft_pct: '87.5',
      points_in_paint: '52', fast_break_points: '14', turnover_points: '11', largest_lead: '16',
    },
  },
  home: {
    ...board.games[0].home,
    linescores: ['28', '30', '31', '28'],
    starters: [],
    bench: [],
    did_not_play: [],
    totals: {
      min: '', pts: '117', fg: '', fg3: '', ft: '', reb: '', ast: '',
      tov: '', stl: '', blk: '', oreb: '', dreb: '', pf: '', plus_minus: '',
    },
    shooting: {
      fg_pct: '', fg3_pct: '', ft_pct: '',
      points_in_paint: '', fast_break_points: '', turnover_points: '', largest_lead: '',
    },
  },
}

const valuePlayer = {
  player_id: '1', name: 'Austin Reaves', position: 'G', team_abbr: 'LAL', team_logo: '',
  opponent_abbr: 'UTAH', is_home: false, game_id: '100', game_status: 'final',
  min: '34', pts: '28', reb: '4', ast: '6', stl: '1', blk: '0', tov: '2',
  fg: '10-18', fg3: '3-7', ft: '5-5', fantasy_team: 'TTP', fantasy_team_name: 'Trust the process',
  stats: { MIN: 34, PTS: 28, REB: 4 },
}

// A second line so the slate has a spread: Reaves is +1 in both categories.
const otherPlayer = {
  ...valuePlayer, player_id: '2', name: 'Bench Guy', min: '12', pts: '4', reb: '2',
  fantasy_team: null, fantasy_team_name: null, stats: { MIN: 12, PTS: 4, REB: 2 },
}

const values = {
  date: '2026-10-25',
  complete: true,
  games_counted: 1,
  categories: ['PTS', 'REB'],
  reverse_categories: [],
  players: [otherPlayer, valuePlayer],
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('BoxScores', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/nba/scoreboard/values')) {
        const date = new URL(url, 'http://localhost').searchParams.get('date')
        return json({ ...values, date })
      }
      if (url.includes('/nba/scoreboard')) {
        const date = new URL(url, 'http://localhost').searchParams.get('date')
        return json({ ...board, date })
      }
      if (url.includes('/boxscore')) return json(box)
      return json({}, 404)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('shows the slate and the selected box score', async () => {
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect(await screen.findByRole('button', { name: /Final/ })).toBeInTheDocument()
    expect(screen.getAllByText('129').length).toBeGreaterThan(0)
    expect((await screen.findAllByRole('link', { name: 'Austin Reaves' })).length).toBeGreaterThan(0)
    expect((await screen.findAllByText("Sit Out (Coach's Decision)")).length).toBeGreaterThan(0)
  })

  it('hides scores while No spoilers is on', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect((await screen.findAllByText('129')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'No spoilers' }))
    await waitFor(() => {
      expect(screen.queryByText('129')).not.toBeInTheDocument()
      expect(screen.queryByText('+12')).not.toBeInTheDocument()
      expect(screen.queryByText('10-18')).not.toBeInTheDocument()
      expect(screen.queryByText('53.3')).not.toBeInTheDocument()
      expect(screen.queryByText("Coach's Decision")).not.toBeInTheDocument()
    })
    expect(screen.getAllByLabelText('Score hidden').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Austin Reaves' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Sit Out').length).toBeGreaterThan(0)
  })

  it('shows each line\'s fantasy team and slate z-score', async () => {
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect(await screen.findByRole('columnheader', { name: 'Z' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Fantasy' })).toBeInTheDocument()
    expect(screen.getAllByText('+1.00').length).toBeGreaterThan(0)
    expect(screen.getAllByTitle('Trust the process').length).toBeGreaterThan(0)
  })

  it('shows the full fantasy team name on tap, and on the lines of the night card', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    // Lines of the night has room for the full name.
    const card = (await screen.findByRole('button', { name: /Lines of the night/ })).closest('section')!
    expect(within(card).getByText('Trust the process')).toBeInTheDocument()
    // The table shows the abbreviation; a tap swaps in the full name and back.
    const table = await screen.findByRole('table', { name: /box score/ })
    const tag = within(table).getByRole('button', { name: 'TTP: Trust the process' })
    expect(tag).toHaveTextContent('TTP')
    await user.click(tag)
    expect(tag).toHaveTextContent('Trust the process')
    expect(tag).toHaveAttribute('aria-expanded', 'true')
    await user.click(tag)
    expect(tag).toHaveTextContent('TTP')
  })

  it('shows lines of the night once the slate is final', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    const toggle = await screen.findByRole('button', { name: /Lines of the night/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/28 PTS · 4 REB · 6 AST/)).toBeInTheDocument()
    await user.click(toggle)
    expect(screen.queryByText(/28 PTS · 4 REB · 6 AST/)).not.toBeInTheDocument()
  })

  it('has no per-game show button in Full box mode', async () => {
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect((await screen.findAllByText('129')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Show this game' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Hide this game again' })).not.toBeInTheDocument()
  })

  it('hides lines of the night while any game is not final', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/nba/scoreboard/values')) return json({ ...values, date, complete: false })
      if (url.includes('/nba/scoreboard')) {
        return json({ ...board, date, games: [{ ...board.games[0], status: 'live', status_detail: 'Q3 4:12' }] })
      }
      if (url.includes('/boxscore')) return json({ ...box, status: 'live' })
      return json({}, 404)
    }))
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect(await screen.findByRole('columnheader', { name: 'Z' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lines of the night/ })).not.toBeInTheDocument()
  })

  it('reveals a single game while No spoilers is on', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect((await screen.findAllByText('129')).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'No spoilers' }))
    await waitFor(() => expect(screen.queryByText('129')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Lines of the night/ })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Show this game' }))
    expect((await screen.findAllByText('129')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('10-18').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Hide this game again' }))
    await waitFor(() => expect(screen.queryByText('129')).not.toBeInTheDocument())
  })

  it('moves to the next date', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await screen.findByRole('button', { name: /Final/ })
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    await waitFor(() => {
      expect(screen.getByLabelText('Choose a date')).toHaveValue('2026-10-26')
    })
  })
})
