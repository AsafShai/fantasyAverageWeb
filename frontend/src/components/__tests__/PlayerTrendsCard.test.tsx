import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { GameLogEntry, GameLogResponse } from '../../types/api'
import PlayerTrendsCard from '../PlayerTrendsCard'

function game(date: string, over: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    game_date: date, matchup: 'MIA vs. BOS', min: 30, usg: 20,
    fgm: 5, fga: 10, ftm: 2, fta: 2, fg3m: 1, fg3a: 3,
    pts: 13, reb: 4, ast: 3, stl: 1, blk: 0, tov: 2, ...over,
  }
}

const LOG: GameLogResponse = {
  player_id: 1, player_name: 'Test Player', season: '2026-27', window_days: 7, window_start: '2026-10-25',
  season_gp: 4, season_mpg: 30, season_usg: 20,
  season_pct: { '3P%': 33.3, 'FT%': 100, 'FG%': 50 }, baseline_pct: {}, league_pct: {}, league_usg: null,
  baseline_seasons: 0,
  games: [
    game('2026-10-21', { pts: 10, blk: 1 }),
    game('2026-10-23', { pts: 10, blk: 1 }),
    game('2026-10-27', { pts: 20, blk: 0 }),
    game('2026-10-29', { pts: 20, blk: 0 }),
  ],
}

const queryArgs: { windowDays: number }[] = []
vi.mock('../../store/api/fantasyApi', () => ({
  useGetTrendGameLogQuery: (args: { windowDays: number }, opts?: { skip?: boolean }) => {
    if (!opts?.skip) queryArgs.push(args)
    return { data: LOG, error: undefined, isLoading: false, refetch: vi.fn() }
  },
}))
// the chart has its own data fetching; here we only care which stat it is asked to draw
vi.mock('../TrendGameLogChart', () => ({
  default: (p: { mode: string; category?: string; stat?: string }) => (
    <div data-testid="chart">{p.mode === 'category' ? p.category : p.mode === 'shooting' ? p.stat : p.mode}</div>
  ),
}))

const LEAGUE = ['PTS', 'BLK', 'STL', 'AST', 'REB', '3PM', 'FG%', 'FT%']

describe('PlayerTrendsCard', () => {
  it('shows every stat in one grid, in the app order, without TO when the league has none', () => {
    render(<PlayerTrendsCard playerId={1} categories={LEAGUE} />)
    const labels = screen.getAllByRole('button', { expanded: false }).map(b => b.querySelector('span > span')?.textContent)
    expect(labels).toEqual(['Usage', 'FG%', 'FT%', '3P%', '3PM', 'REB', 'AST', 'STL', 'BLK', 'PTS'])
    // the section's own fold toggle (titled Trends) is open too; only one stat is
    const openStats = screen.getAllByRole('button', { expanded: true }).filter(b => b.textContent !== 'Trends')
    expect(openStats).toHaveLength(1)
    expect(openStats[0]).toHaveTextContent('Minutes')
    expect(screen.queryByText('TO')).not.toBeInTheDocument()
  })

  it('opens a stat on click and closes it on a second click', async () => {
    const user = userEvent.setup()
    render(<PlayerTrendsCard playerId={1} categories={LEAGUE} />)
    expect(screen.getByTestId('chart')).toHaveTextContent('minutes')

    const pts = screen.getByRole('button', { name: /^PTS/ })
    await user.click(pts)
    expect(pts).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('chart')).toHaveTextContent('PTS')

    await user.click(pts)
    expect(pts).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
  })

  it('colours every change by direction, with no minimum', () => {
    render(<PlayerTrendsCard playerId={1} categories={LEAGUE} />)
    // PTS 15.0 season -> 20.0 window: up; BLK 0.5 -> 0.0: down
    expect(screen.getByText('+5.0')).toHaveClass('text-emerald-700')
    expect(screen.getByText('-0.5')).toHaveClass('text-red-600')
  })

  it('follows the page time frame instead of its own picker', () => {
    queryArgs.length = 0
    render(<PlayerTrendsCard playerId={1} categories={LEAGUE} timePeriod="last_7" />)
    expect(queryArgs.at(-1)?.windowDays).toBe(7)
    expect(screen.getByText(/Last 7 days vs season/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '15d' })).not.toBeInTheDocument()
  })

  it('explains the 15-day fallback on Full Season', () => {
    render(<PlayerTrendsCard playerId={1} categories={LEAGUE} timePeriod="season" />)
    expect(screen.getByText(/Last 15 days vs season/)).toBeInTheDocument()
    expect(screen.getByText(/Full Season has no recent stretch to compare/)).toBeInTheDocument()
  })
})
