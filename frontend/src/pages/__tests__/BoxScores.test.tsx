import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MyTeamProvider } from '../../context/MyTeamContext'
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
      player_id: '1', name: 'Austin Reaves', jersey: '15', position: 'G', ejected: false, on_court: false,
      min: '34', pts: '28', fg: '10-18', fg3: '3-7', ft: '5-5', reb: '4', ast: '6',
      tov: '2', stl: '1', blk: '0', oreb: '1', dreb: '3', pf: '2', plus_minus: '+12',
    }],
    bench: [],
    did_not_play: [{ player_id: '9', name: 'Sit Out', jersey: '0', position: 'F', reason: "Coach's Decision" }],
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

  it('shows the slate and opens a box score after the game is clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    expect(await screen.findByRole('button', { name: /Final/ })).toBeInTheDocument()
    expect(screen.getAllByText('129').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Austin Reaves' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Final/ }))
    const table = await screen.findByRole('table', { name: /box score/ })
    expect(within(table).getByRole('link', { name: 'Austin Reaves' })).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Starters' })).toBeInTheDocument()
    expect(within(table).queryByText('Started')).not.toBeInTheDocument()
    expect(within(table).queryByText('On court')).not.toBeInTheDocument()
    expect((await screen.findAllByText("Sit Out (Coach's Decision)")).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /Final/, pressed: true }))
    expect(screen.queryByRole('table', { name: /box score/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Final/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hides scores while No spoilers is on', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await user.click(await screen.findByRole('button', { name: /Final/ }))
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
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await user.click(await screen.findByRole('button', { name: /Final/ }))
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
    await user.click(screen.getByRole('button', { name: /Final/ }))
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
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await user.click(await screen.findByRole('button', { name: /Final/ }))
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
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await user.click(await screen.findByRole('button', { name: /Q3/ }))
    expect(await screen.findByRole('columnheader', { name: 'Z' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lines of the night/ })).not.toBeInTheDocument()
  })

  it('splits a live box by who is on the court and marks fouls and ejections', async () => {
    const user = userEvent.setup()
    const onFloor = {
      ...box.away.starters[0], on_court: true, pf: '2',
    }
    const sat = {
      ...box.away.starters[0],
      player_id: '4', name: 'Giannis Antetokounmpo', on_court: false, pf: '6', ejected: false,
    }
    const tossed = {
      ...box.away.starters[0],
      player_id: '5', name: 'Tossed Out', on_court: true, pf: '2', ejected: true,
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/nba/scoreboard/values')) return json({ ...values, date, complete: false })
      if (url.includes('/nba/scoreboard')) {
        return json({ ...board, date, games: [{ ...board.games[0], status: 'live', status_detail: 'Q3 4:12' }] })
      }
      if (url.includes('/boxscore')) {
        return json({
          ...box,
          status: 'live',
          status_detail: 'Q3 4:12',
          away: { ...box.away, starters: [onFloor, sat], bench: [tossed] },
        })
      }
      return json({}, 404)
    }))
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await user.click(await screen.findByRole('button', { name: /Q3/ }))
    const table = await screen.findByRole('table', { name: /box score/ })
    expect(within(table).getByRole('columnheader', { name: 'On the court' })).toBeInTheDocument()
    expect(within(table).queryByRole('columnheader', { name: 'Starters' })).not.toBeInTheDocument()
    const headers = within(table).getAllByRole('columnheader').map(header => header.textContent)
    const onCourtAt = headers.indexOf('On the court')
    const benchAt = headers.indexOf('Bench')
    expect(onCourtAt).toBeGreaterThanOrEqual(0)
    expect(benchAt).toBeGreaterThan(onCourtAt)
    expect(within(table).queryByText('On court')).not.toBeInTheDocument()
    expect(within(table).getAllByTitle('On court')).toHaveLength(2)
    const nameCell = within(table).getByRole('link', { name: 'Austin Reaves' }).closest('th')
    expect(nameCell).toHaveClass('sticky')
    expect(nameCell).toHaveTextContent('Austin Reaves')
    expect(nameCell).toHaveTextContent('15')
    expect(nameCell).toHaveTextContent('G')
    expect(within(table).getByRole('link', { name: 'Austin Reaves' }).parentElement?.previousElementSibling).toHaveTextContent('15')
    expect(nameCell).not.toHaveTextContent('Started')
    expect(nameCell).toHaveClass('bg-white')
    expect(nameCell?.previousElementSibling).not.toHaveClass('sticky')
    expect(nameCell?.previousElementSibling?.querySelector('[title="On court"]')).toBeTruthy()
    expect(nameCell?.nextElementSibling).not.toHaveClass('sticky')
    expect(nameCell?.nextElementSibling).toHaveTextContent('Started')
    const started = within(table).getAllByTitle('Starting five').map(mark => mark.closest('tr')?.querySelector('a')?.textContent)
    expect(started).toEqual(['Austin Reaves', 'Giannis Antetokounmpo'])
    const longName = within(table).getByRole('link', { name: 'Giannis Antetokounmpo' })
    expect(longName.parentElement).toHaveClass('max-w-[38vw]', 'whitespace-normal', 'sm:whitespace-nowrap')
    expect(longName.closest('th')).not.toHaveTextContent('Started')
    expect(longName.closest('th')).toHaveClass('bg-white')
    expect(within(table).getByRole('link', { name: 'Austin Reaves' }).parentElement).toHaveClass('whitespace-nowrap')
    expect(within(table).getByRole('link', { name: 'Austin Reaves' }).parentElement).not.toHaveClass('max-w-[38vw]')
    expect(within(table).getByText('Fouled out')).toBeInTheDocument()
    expect(within(table).getByText('Ejected')).toBeInTheDocument()
    expect(within(table).getByTitle('Fouled out')).toHaveTextContent('6')
    const names = within(table).getAllByRole('row').map(row => within(row).queryByRole('link')?.textContent).filter(Boolean)
    expect(names).toEqual(['Austin Reaves', 'Tossed Out', 'Giannis Antetokounmpo'])
  })

  it('reveals a single game while No spoilers is on', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    await user.click(await screen.findByRole('button', { name: /Final/ }))
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

  it('lists both rosters and a countdown before tip', async () => {
    const user = userEvent.setup()
    const scheduled = {
      ...board.games[0],
      game_id: '200',
      status: 'scheduled',
      status_detail: '7:00 PM EDT',
      start_time: '2099-01-01T00:00:00Z',
      away: { ...board.games[0].away, score: null, winner: false },
      home: { ...board.games[0].home, score: null, winner: false },
    }
    const blank = {
      linescores: [], starters: [], bench: [], did_not_play: [],
      totals: { min: '', pts: '', fg: '', fg3: '', ft: '', reb: '', ast: '', tov: '', stl: '', blk: '', oreb: '', dreb: '', pf: '', plus_minus: '' },
      shooting: { fg_pct: '', fg3_pct: '', ft_pct: '', points_in_paint: '', fast_break_points: '', turnover_points: '', largest_lead: '' },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/depthchart')) {
        const teamId = url.match(/nba-teams\/(\d+)/)?.[1]
        const athletes = teamId === '26'
          ? [{ id: '24', display_name: 'Lauri Markkanen', short_name: 'L. Markkanen' }]
          : [
            { id: '23', display_name: 'LeBron James', short_name: 'L. James' },
            { id: '99', display_name: 'Allonzo Trier', short_name: 'A. Trier' },
          ]
        const position = teamId === '26' ? 'PF' : 'SF'
        return json({
          team_id: teamId, team_name: '', team_abbreviation: '', team_logo: '', record: '',
          positions: [{ abbreviation: position, display_name: position, players: athletes }],
        })
      }
      if (url.includes('/players')) {
        return json({
          players: [
            { player_name: 'LeBron James', pro_team: 'LAL', positions: ['SF'], team_id: 8, status: 'ONTEAM', player_id: 23, fantasy_team_name: "Dor's Injured Team", stats: { gp: 0, minutes: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, three_pm: 0, fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 } },
            { player_name: 'Lauri Markkanen', pro_team: 'UTA', positions: ['PF'], team_id: 0, status: 'FREEAGENT', player_id: 24, fantasy_team_name: null, stats: { gp: 0, minutes: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, three_pm: 0, fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 } },
            { player_name: 'Allonzo Trier', pro_team: 'LAL', positions: ['SG'], team_id: 0, status: 'FREEAGENT', player_id: 99, fantasy_team_name: null, stats: { gp: 0, minutes: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, three_pm: 0, fg_percentage: 0, ft_percentage: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 } },
          ],
          total_count: 3, page: 1, limit: 1200, has_more: false,
        })
      }
      if (url.includes('/teams')) {
        return json([{ team_id: 8, team_name: "Dor's Injured Team", abbrev: 'DOR' }])
      }
      if (url.includes('/nba/scoreboard')) return json({ date, games: [scheduled] })
      if (url.includes('/boxscore')) {
        return json({ ...scheduled, periods: [], away: { ...scheduled.away, ...blank }, home: { ...scheduled.home, ...blank } })
      }
      return json({}, 404)
    }))
    renderWithProviders(<BoxScores />, { route: '/box-scores?date=2026-10-25' })
    const card = await screen.findByRole('button', { name: /LAL/ })
    expect(screen.queryByRole('link', { name: 'LeBron James' })).not.toBeInTheDocument()
    await user.click(card)
    expect(await screen.findByRole('link', { name: 'LeBron James' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Hide Unrostered Players' })).not.toBeChecked()
    expect(screen.getByRole('link', { name: 'Lauri Markkanen' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Allonzo Trier' })).toBeInTheDocument()
    expect(screen.getAllByTitle('Free agent that night').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: "DOR: Dor's Injured Team" })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Hide Unrostered Players' }))
    expect(screen.queryByRole('link', { name: 'Lauri Markkanen' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Allonzo Trier' })).not.toBeInTheDocument()
    expect(screen.queryByTitle('Free agent that night')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'LeBron James' })).toBeInTheDocument()
    expect(screen.getByText('No rostered players.')).toBeInTheDocument()
    expect(screen.getByText('Starts in')).toBeInTheDocument()
    expect(screen.getByText(/\d+d \d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.queryByText('The box score is not available yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Team' })).not.toBeInTheDocument()
  })

  it('counts my players on each card and highlights them before tip and in the box', async () => {
    localStorage.setItem('fw:myTeam.id', '8')
    const user = userEvent.setup()
    const stats = { gp: 1, minutes: 30, pts: 20, reb: 4, ast: 4, stl: 1, blk: 0, three_pm: 2, fg_percentage: 0.5, ft_percentage: 0.8, fgm: 8, fga: 16, ftm: 4, fta: 5 }
    const scheduled = {
      ...board.games[0],
      game_id: '200',
      status: 'scheduled' as const,
      status_detail: '7:00 PM EDT',
      start_time: '2099-01-01T00:00:00Z',
      away: { ...board.games[0].away, score: null, winner: false },
      home: { ...board.games[0].home, score: null, winner: false },
    }
    const blank = {
      linescores: [], starters: [], bench: [], did_not_play: [],
      totals: { min: '', pts: '', fg: '', fg3: '', ft: '', reb: '', ast: '', tov: '', stl: '', blk: '', oreb: '', dreb: '', pf: '', plus_minus: '' },
      shooting: { fg_pct: '', fg3_pct: '', ft_pct: '', points_in_paint: '', fast_break_points: '', turnover_points: '', largest_lead: '' },
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/teams/') && url.includes('/players')) {
        return json({
          team_id: 8,
          last_updated: '2026-10-25',
          players: [
            { player_name: 'LeBron James', pro_team: 'LAL', positions: ['SF'], team_id: 8, status: 'ONTEAM', player_id: 23, fantasy_team_name: "Dor's Injured Team", stats },
            { player_name: 'Boston Guy', pro_team: 'BOS', positions: ['SG'], team_id: 8, status: 'ONTEAM', player_id: 50, fantasy_team_name: "Dor's Injured Team", stats },
          ],
        })
      }
      if (url.includes('/depthchart')) {
        const teamId = url.match(/nba-teams\/(\d+)/)?.[1]
        const athletes = teamId === '26'
          ? [{ id: '24', display_name: 'Lauri Markkanen', short_name: 'L. Markkanen' }]
          : [{ id: '23', display_name: 'LeBron James', short_name: 'L. James' }]
        return json({
          team_id: teamId, team_name: '', team_abbreviation: '', team_logo: '', record: '',
          positions: [{ abbreviation: 'SF', display_name: 'SF', players: athletes }],
        })
      }
      if (url.includes('/players')) {
        return json({
          players: [
            { player_name: 'LeBron James', pro_team: 'LAL', positions: ['SF'], team_id: 8, status: 'ONTEAM', player_id: 23, fantasy_team_name: "Dor's Injured Team", stats },
            { player_name: 'Lauri Markkanen', pro_team: 'UTA', positions: ['PF'], team_id: 0, status: 'FREEAGENT', player_id: 24, fantasy_team_name: null, stats },
          ],
          total_count: 2, page: 1, limit: 1200, has_more: false,
        })
      }
      if (url.includes('/teams')) return json([{ team_id: 8, team_name: "Dor's Injured Team", abbrev: 'DOR' }])
      if (url.includes('/nba/scoreboard')) return json({ date, games: [scheduled] })
      if (url.includes('/boxscore')) return json({ ...scheduled, periods: [], away: { ...scheduled.away, ...blank }, home: { ...scheduled.home, ...blank } })
      return json({}, 404)
    }))
    renderWithProviders(<MyTeamProvider><BoxScores /></MyTeamProvider>, { route: '/box-scores?date=2026-10-25' })
    const card = await screen.findByRole('button', { name: /1 from your team/ })
    expect(screen.queryByRole('button', { name: /2 from your team/ })).not.toBeInTheDocument()
    await user.click(card)
    expect(screen.getByRole('button', { name: /My players/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /1 yet to play/ })).toBeInTheDocument()
    await waitFor(() => {
      const highlighted = screen.getAllByRole('link', { name: 'LeBron James' })
        .map(link => link.closest('li'))
        .find(item => item?.classList.contains('bg-blue-50'))
      expect(highlighted).toBeTruthy()
    })
    expect(screen.getByRole('link', { name: 'Lauri Markkanen' })).toBeInTheDocument()
    expect(screen.getAllByTitle('Free agent that night').length).toBeGreaterThan(0)
  })

  it('hides players who are out before tip and shows a lesser injury', async () => {
    localStorage.setItem('fw:myTeam.id', '8')
    const user = userEvent.setup()
    const stats = { gp: 1, minutes: 30, pts: 20, reb: 4, ast: 4, stl: 1, blk: 0, three_pm: 2, fg_percentage: 0.5, ft_percentage: 0.8, fgm: 8, fga: 16, ftm: 4, fta: 5 }
    const scheduled = {
      ...board.games[0],
      game_id: '200',
      status: 'scheduled' as const,
      status_detail: '7:00 PM EDT',
      start_time: '2099-01-01T00:00:00Z',
      away: { ...board.games[0].away, score: null, winner: false },
      home: { ...board.games[0].home, score: null, winner: false },
    }
    const blank = {
      linescores: [], starters: [], bench: [], did_not_play: [],
      totals: { min: '', pts: '', fg: '', fg3: '', ft: '', reb: '', ast: '', tov: '', stl: '', blk: '', oreb: '', dreb: '', pf: '', plus_minus: '' },
      shooting: { fg_pct: '', fg3_pct: '', ft_pct: '', points_in_paint: '', fast_break_points: '', turnover_points: '', largest_lead: '' },
    }
    const roster = [
      { player_name: 'LeBron James', pro_team: 'LAL', positions: ['SF'], team_id: 8, status: 'ONTEAM', player_id: 23, fantasy_team_name: "Dor's Injured Team", stats },
      { player_name: 'Anthony Davis', pro_team: 'LAL', positions: ['PF'], team_id: 8, status: 'ONTEAM', player_id: 3, fantasy_team_name: "Dor's Injured Team", stats },
    ]
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/teams/') && url.includes('/players')) {
        return json({ team_id: 8, last_updated: '2026-10-25', players: roster })
      }
      if (url.includes('/depthchart')) {
        const teamId = url.match(/nba-teams\/(\d+)/)?.[1]
        const athletes = teamId === '13'
          ? [
            { id: '23', display_name: 'LeBron James', short_name: 'L. James', injury: { status: 'Questionable' } },
            { id: '3', display_name: 'Anthony Davis', short_name: 'A. Davis', injury: { status: 'Out' } },
          ]
          : []
        return json({
          team_id: teamId, team_name: '', team_abbreviation: '', team_logo: '', record: '',
          positions: [{ abbreviation: 'SF', display_name: 'SF', players: athletes }],
        })
      }
      if (url.includes('/players')) {
        return json({ players: roster, total_count: roster.length, page: 1, limit: 1200, has_more: false })
      }
      if (url.includes('/teams')) return json([{ team_id: 8, team_name: "Dor's Injured Team", abbrev: 'DOR' }])
      if (url.includes('/nba/scoreboard')) return json({ date, games: [scheduled] })
      if (url.includes('/boxscore')) return json({ ...scheduled, periods: [], away: { ...scheduled.away, ...blank }, home: { ...scheduled.home, ...blank } })
      return json({}, 404)
    }))
    renderWithProviders(<MyTeamProvider><BoxScores /></MyTeamProvider>, { route: '/box-scores?date=2026-10-25' })
    const card = await screen.findByRole('button', { name: /1 from your team/ })
    expect(screen.queryByRole('button', { name: /2 from your team/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 yet to play/ })).toBeInTheDocument()
    await user.click(card)
    expect(await screen.findByRole('link', { name: 'LeBron James' })).toBeInTheDocument()
    expect(screen.getByText('Questionable')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Anthony Davis' })).not.toBeInTheDocument()
    expect(screen.queryByText('Out')).not.toBeInTheDocument()
  })

  it('highlights my players in a finished box, including who did not play', async () => {
    localStorage.setItem('fw:myTeam.id', '8')
    const user = userEvent.setup()
    const stats = { gp: 1, minutes: 30, pts: 20, reb: 4, ast: 4, stl: 1, blk: 0, three_pm: 2, fg_percentage: 0.5, ft_percentage: 0.8, fgm: 8, fga: 16, ftm: 4, fta: 5 }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/teams/') && url.includes('/players')) {
        return json({
          team_id: 8,
          last_updated: '2026-10-25',
          players: [
            { player_name: 'Austin Reaves', pro_team: 'LAL', positions: ['G'], team_id: 8, status: 'ONTEAM', player_id: 1, fantasy_team_name: "Dor's Injured Team", stats },
            { player_name: 'Sit Out', pro_team: 'LAL', positions: ['F'], team_id: 8, status: 'ONTEAM', player_id: 9, fantasy_team_name: "Dor's Injured Team", stats },
            { player_name: 'Boston Guy', pro_team: 'BOS', positions: ['SG'], team_id: 8, status: 'ONTEAM', player_id: 50, fantasy_team_name: "Dor's Injured Team", stats },
          ],
        })
      }
      if (url.includes('/teams')) return json([{ team_id: 8, team_name: "Dor's Injured Team", abbrev: 'DOR' }])
      if (url.includes('/nba/scoreboard/values')) return json({ ...values, date })
      if (url.includes('/nba/scoreboard')) return json({ ...board, date })
      if (url.includes('/boxscore')) return json(box)
      return json({}, 404)
    }))
    renderWithProviders(<MyTeamProvider><BoxScores /></MyTeamProvider>, { route: '/box-scores?date=2026-10-25' })
    const card = await screen.findByRole('button', { name: /2 from your team/ })
    await user.click(card)
    const table = await screen.findByRole('table', { name: /box score/ })
    expect(within(table).getByRole('link', { name: 'Austin Reaves' }).closest('tr')).toHaveClass('bg-blue-50')
    expect(screen.getAllByText("Sit Out (Coach's Decision)").some(item => item.parentElement?.classList.contains('bg-blue-100'))).toBe(true)
    await user.click(screen.getByRole('button', { name: 'No spoilers' }))
    const hidden = await screen.findAllByRole('link', { name: 'Austin Reaves' })
    expect(hidden.map(link => link.closest('li')).find(item => item?.classList.contains('bg-blue-50'))).toBeTruthy()
  })

  it('hides finished lines in My players while No spoilers is on', async () => {
    localStorage.setItem('fw:myTeam.id', '8')
    const user = userEvent.setup()
    const stats = { gp: 1, minutes: 30, pts: 20, reb: 4, ast: 4, stl: 1, blk: 0, three_pm: 2, fg_percentage: 0.5, ft_percentage: 0.8, fgm: 8, fga: 16, ftm: 4, fta: 5 }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      const date = new URL(url, 'http://localhost').searchParams.get('date')
      if (url.includes('/teams/') && url.includes('/players')) {
        return json({
          team_id: 8,
          last_updated: '2026-10-25',
          players: [
            { player_name: 'Austin Reaves', pro_team: 'LAL', positions: ['G'], team_id: 8, status: 'ONTEAM', player_id: 1, fantasy_team_name: "Dor's Injured Team", stats },
            { player_name: 'Sit Out', pro_team: 'LAL', positions: ['F'], team_id: 8, status: 'ONTEAM', player_id: 9, fantasy_team_name: "Dor's Injured Team", stats },
            { player_name: 'Boston Guy', pro_team: 'BOS', positions: ['SG'], team_id: 8, status: 'ONTEAM', player_id: 50, fantasy_team_name: "Dor's Injured Team", stats },
          ],
        })
      }
      if (url.includes('/teams')) return json([{ team_id: 8, team_name: "Dor's Injured Team", abbrev: 'DOR' }])
      if (url.includes('/nba/scoreboard/values')) return json({ ...values, date })
      if (url.includes('/nba/scoreboard')) return json({ ...board, date })
      if (url.includes('/boxscore')) return json(box)
      return json({}, 404)
    }))
    renderWithProviders(<MyTeamProvider><BoxScores /></MyTeamProvider>, { route: '/box-scores?date=2026-10-25' })
    const toggleFirst = await screen.findByRole('button', { name: /My players/ })
    expect(toggleFirst).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggleFirst)
    const section = screen.getByRole('region', { name: 'My players' })
    expect(within(section).getByRole('heading', { name: 'Finished' })).toBeInTheDocument()
    expect(within(section).getByRole('button', { name: /LAL 129 @ UTAH 117/ })).toBeInTheDocument()
    expect(within(section).queryByRole('heading', { name: 'Playing' })).not.toBeInTheDocument()
    expect(within(section).queryByText('Boston Guy')).not.toBeInTheDocument()
    expect(await within(section).findByRole('table', { name: 'Austin Reaves line' })).toBeInTheDocument()
    expect(within(section).getByText('28')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'No spoilers' }))
    const toggle = screen.getByRole('button', { name: /My players/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Contains spoilers')
    await user.click(toggle)
    const opened = screen.getByRole('region', { name: 'My players' })
    expect(within(opened).getAllByText('Stats hidden').length).toBeGreaterThan(0)
    expect(within(opened).queryByText('28')).not.toBeInTheDocument()
    expect(within(opened).queryByRole('button', { name: /129/ })).not.toBeInTheDocument()
    expect(within(opened).getByRole('button', { name: /LAL @ UTAH · Final/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show results' }))
    expect(await within(opened).findByText('28')).toBeInTheDocument()
    expect(within(opened).getByRole('button', { name: /LAL 129 @ UTAH 117/ })).toBeInTheDocument()
    expect(within(opened).getByText("Did not play · Coach's Decision")).toBeInTheDocument()
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
