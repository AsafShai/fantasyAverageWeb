import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import Rankings from '../Rankings'

let mobile = false
vi.mock('../../mobile/flag', () => ({ useMobileRedesign: () => mobile }))

const cats = ['FG%', 'FT%', '3PM', 'AST', 'REB', 'STL', 'BLK', 'PTS']
const row = (id: number, name: string) => ({
  team: { team_id: id, team_name: name }, fg_percentage: 0.46, ft_percentage: 0.8, three_pm: 1, ast: 1, reb: 1, stl: 1, blk: 1, pts: 1,
  gp: 50, total_points: 8, rank: id, category_ranks: Object.fromEntries(cats.map(c => [c, 2])),
  stats: Object.fromEntries(cats.map(c => [c, 1])),
})
const live = { active: true, period: 24, as_of: '2026-11-13T01:42:00Z', games_total: 4, games_live: 2, games_final: 1, official_updated_at: '2026-11-12T08:15:00Z' }

const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'Content-Type': 'application/json' } })

function stub(withLive: boolean, calls: string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: Request) => {
    const url = input.url
    calls.push(url)
    if (url.includes('/rankings')) {
      return json({
        averages_rankings: [row(1, 'Alpha Squad')], totals_rankings: [row(1, 'Alpha Squad')],
        categories: [...cats, 'TOTAL_POINTS'], last_updated: '2026-11-13', ...(withLive ? { live } : {}),
      })
    }
    if (url.includes('rank-changes')) return json({ previous_period: 1, latest_period: 2, teams: [] })
    if (url.includes('/league/summary')) return json({ nba_avg_pace: 100, nba_game_days_left: 30, season_start: '2025-10-01', espn_updated_at: '2026-11-12T08:15:00Z' })
    if (url.includes('current-slate-date')) return json('2026-11-12')
    if (url.includes('scoreboard')) return json({ date: '2026-11-12', games: [] })
    return new Response('not found', { status: 404 })
  }))
}

describe.each([['desktop', false], ['mobile', true]])('Rankings live badge (%s)', (_n, isMobile) => {
  beforeEach(() => { mobile = isMobile as boolean; localStorage.clear() })
  afterEach(() => vi.unstubAllGlobals())

  it('is exactly as before without a live block: ESPN note, no badge', async () => {
    stub(false)
    renderWithProviders(<Rankings />)
    await waitFor(() => expect(screen.getByText('Alpha Squad')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/ESPN updated/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /LIVE/ })).toBeNull()
    expect(screen.queryByText(/Averages count finished games only/)).toBeNull()
  })

  it('shows the LIVE badge in place of the ESPN note', async () => {
    stub(true)
    renderWithProviders(<Rankings />)
    expect(await screen.findByRole('button', { name: /LIVE/ })).toBeInTheDocument()
    expect(screen.queryByText(/ESPN updated/)).toBeNull()
  })

  it('explains what averages and totals count', async () => {
    stub(true)
    renderWithProviders(<Rankings />)
    const badge = await screen.findByRole('button', { name: /LIVE/ })
    if (isMobile) {
      await userEvent.click(badge)
      expect(await screen.findByText('Averages count finished games only. 2 games still in progress.')).toBeInTheDocument()
    } else {
      expect(screen.getByText(/Averages count finished games only/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /^totals$/i }))
      expect(screen.getByText('Totals include the 2 games still in progress.')).toBeInTheDocument()
    }
  })
})
