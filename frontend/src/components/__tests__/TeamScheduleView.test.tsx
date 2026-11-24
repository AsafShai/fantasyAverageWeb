import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import TeamScheduleView from '../TeamScheduleView'

function game(id: string, date: string, opponent: string, rest: number | null, highVolume = false) {
  return {
    game_id: id, date, opponent_id: 2, opponent, opponent_abbreviation: opponent.slice(0, 3).toUpperCase(),
    is_home: true, rest_days: rest, slate_size: highVolume ? 11 : 6, high_volume: highVolume,
  }
}

const schedule = {
  season: '2026-27',
  high_volume_threshold: 10,
  calendar_days: [],
  published_games_min: 80,
  published_games_max: 80,
  teams: [{
    team_id: 13, abbreviation: 'LAL', team_name: 'Los Angeles Lakers',
    games: [
      game('1', '2026-10-20', 'Past Opponent', null, true),
      game('2', '2026-10-21', 'Second Past', 0),
      game('3', '2026-10-26', 'Tonight Opponent', 4, true),
      game('4', '2026-10-27', 'Tomorrow Opponent', 0),
    ],
    monthly_games: {}, total_games: 80, b2b_count: 2, high_volume_games: 2, avg_rest_days: 1,
  }],
}

const result = (id: string, date: string, won: boolean, us: number, them: number) => ({
  game_id: id, date, is_home: true, opponent_id: 2, opponent_abbreviation: 'BOS', team_score: us, opponent_score: them, won,
})
const results = [result('1', '2026-10-20', true, 110, 101), result('2', '2026-10-21', false, 99, 104)]

describe('TeamScheduleView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-10-26T16:00:00Z'))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const body = url.includes('/results') ? results : schedule
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('lists only the games left, from today on', async () => {
    renderWithProviders(<TeamScheduleView teamId="13" />)
    expect(await screen.findByText('Tonight Opponent')).toBeInTheDocument()
    expect(screen.getByText('Tomorrow Opponent')).toBeInTheDocument()
    expect(screen.queryByText('Past Opponent')).not.toBeInTheDocument()
    expect(screen.queryByText('Second Past')).not.toBeInTheDocument()
    expect(screen.getByText('Games left').parentElement).toHaveTextContent('2')
    expect(screen.getByText('Back-to-backs left').parentElement).toHaveTextContent('1')
    expect(screen.getByText('High-volume left').parentElement).toHaveTextContent('1')
  })
  it('shows results in date order with scores and box score links', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<TeamScheduleView teamId="13" />)
    await user.click(await screen.findByRole('button', { name: /^Results/ }))
    expect(screen.getByRole('button', { name: /^Results/ })).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('fw:team-schedule-view')).toBe('results')
    const links = await screen.findAllByRole('link', { name: /^Box score:/ })
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/box-scores?date=2026-10-20&game=1',
      '/box-scores?date=2026-10-21&game=2',
    ])
    expect(links[0]).toHaveAccessibleName('Box score: Win 110-101 vs Past Opponent, Oct 20')
    expect(screen.getByText('110-101')).toBeInTheDocument()
    expect(screen.queryByText('Tonight Opponent')).not.toBeInTheDocument()
    expect(screen.getByText('Record').parentElement).toHaveTextContent('1-1')
    expect(screen.getByText(/1-1 · 2 played, 2 left/)).toBeInTheDocument()
  })

  it('shows the whole season with a line at today', async () => {
    localStorage.setItem('fw:team-schedule-view', 'all')
    renderWithProviders(<TeamScheduleView teamId="13" />)
    expect(await screen.findByText('Tonight Opponent')).toBeInTheDocument()
    expect(screen.getByText('Past Opponent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^All/ })).toHaveAttribute('aria-pressed', 'true')
    const today = screen.getByTestId('schedule-today')
    expect(today).toHaveTextContent('Today')
    expect(today).toHaveAttribute('title', 'Today, Oct 26')
    const rows = [...screen.getByRole('table').querySelectorAll('tr[data-row-index]')]
    // Today's line is the top edge of tonight's game, the first not yet played.
    expect(rows[2]).toContainElement(today)
    expect(rows[2].className).toContain('border-t-blue-500')
    expect(rows[1].className).not.toContain('border-t-blue-500')
    expect(await screen.findAllByRole('link', { name: /^Box score:/ })).toHaveLength(2)
    expect(screen.getByText('0 · B2B')).toBeInTheDocument()
  })
})
