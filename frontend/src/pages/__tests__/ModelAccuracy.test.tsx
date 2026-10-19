import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AccuracyMisses, AccuracySummary, AccuracyWeekly, PlayerAccuracyRow } from '../../types/api'
import { renderWithProviders } from '../../test/helpers'
import ModelAccuracy from '../ModelAccuracy'

const categories = [
  { key: 'pts', label: 'PTS', band: 4, model_mae: 5.12, baseline_mae: 5.94, hit_rate: 0.58, games: 120 },
  { key: 'reb', label: 'REB', band: 2, model_mae: 2.21, baseline_mae: 2.43, hit_rate: 0.62, games: 120 },
  { key: 'ft_pct', label: 'FT%', band: 15, model_mae: 15.2, baseline_mae: 15.0, hit_rate: 0.62, games: 50 },
]

const pregame: AccuracySummary = {
  mode: 'pregame', window: 'season', start: '2026-10-21', end: '2026-12-13', games: 120, dnp: 7,
  categories,
  minutes: { key: 'min', label: 'MIN', band: 5, model_mae: 5.4, baseline_mae: 6.1, hit_rate: 0.64, games: 120 },
  first_snapshot_date: '2026-10-21',
}
const retro: AccuracySummary = {
  ...pregame, mode: 'retro', dnp: 0, minutes: null,
  categories: categories.map(c => ({ ...c, model_mae: (c.model_mae ?? 0) - 1 })),
}
const emptyPregame: AccuracySummary = { ...pregame, games: 0, dnp: 0, categories: [], minutes: null }

const weekly: AccuracyWeekly = {
  mode: 'pregame',
  weeks: [
    { week_start: '2026-11-30', games: 60, categories: { pts: { model_mae: 5.3, baseline_mae: 6.0 } } },
    { week_start: '2026-12-07', games: 60, categories: { pts: { model_mae: 5.0, baseline_mae: 5.9 } } },
  ],
}

const misses: AccuracyMisses = {
  week_start: '2026-12-07',
  misses: [{
    player_id: 3917376, player_name: 'Jaylen Brown', game_date: '2026-12-10', team_id: 2, team: 'BOS',
    opponent_team_id: 14, opponent: 'MIA', is_home: false, z: -6.8,
    line: [{ stat: 'MIN', proj: 34, actual: 0 }, { stat: 'PTS', proj: 26.4, actual: 0 }],
    reason: 'DNP', reason_detail: 'Projected 34 min; listed Questionable at snapshot',
  }],
}

const game = (z: number, d: number) => ({
  game_date: `2026-12-0${d}`, opponent_team_id: 1, opponent: 'ATL', z, proj_pts: 25, actual_pts: 25 + z * 4, proj_min: 34, actual_min: 35,
})
const players: PlayerAccuracyRow[] = [
  { player_id: 1, player_name: 'Rostered Star', team_id: 8, team: 'DET', games: [1, 1, 1, 2, 1].map(game), dnp: 0, proj_pts: 25.7, actual_pts: 28.9, proj_min: 34.9, actual_min: 36.2, flag: 'up' },
  { player_id: 2, player_name: 'Free Agent Guy', team_id: 1, team: 'ATL', games: [-1, -1, 0.5].map(game), dnp: 1, proj_pts: 10, actual_pts: 8, proj_min: 22, actual_min: 20, flag: 'flat' },
]

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function stubApi(summaries: { pregame: AccuracySummary; retro: AccuracySummary }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/model-accuracy/summary')) {
      return jsonResponse(url.includes('mode=retro') ? summaries.retro : summaries.pregame)
    }
    if (url.includes('/model-accuracy/weekly')) return jsonResponse(weekly)
    if (url.includes('/model-accuracy/misses')) return jsonResponse(misses)
    if (url.includes('/model-accuracy/players')) return jsonResponse({ players })
    if (url.includes('/players')) {
      return jsonResponse({
        players: [{ player_id: 1, team_id: 4, status: 'ONTEAM', player_name: 'Rostered Star' }],
        total_count: 1, page: 1, limit: 1200, has_more: false,
      })
    }
    return new Response('not found', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('ModelAccuracy page', () => {
  beforeAll(() => {
    // recharts' ResponsiveContainer measures its parent.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows headline tiles and the per-category comparison against the baseline', async () => {
    stubApi({ pregame, retro })
    renderWithProviders(<ModelAccuracy />)

    await waitFor(() => expect(screen.getByText('Accuracy by category')).toBeInTheDocument())
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    expect(screen.getByText('5.4 min')).toBeInTheDocument()
    expect(screen.getByText(/7 projected players didn't play/)).toBeInTheDocument()

    const ptsRow = screen.getByRole('cell', { name: 'PTS' }).closest('tr')!
    expect(within(ptsRow).getByText('5.12')).toBeInTheDocument()
    expect(within(ptsRow).getByText('5.94')).toBeInTheDocument()
    expect(within(ptsRow).getByRole('img', { name: '-13.8% vs baseline' })).toBeInTheDocument()
  })

  it('lists the biggest misses with their reason and only rostered players by default', async () => {
    stubApi({ pregame, retro })
    renderWithProviders(<ModelAccuracy />)

    await waitFor(() => expect(screen.getByText('Jaylen Brown')).toBeInTheDocument())
    expect(screen.getByText('DNP')).toBeInTheDocument()
    expect(screen.getByText('Projected 34 min; listed Questionable at snapshot')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByText('Rostered Star')).toBeInTheDocument())
    expect(screen.queryByText('Free Agent Guy')).not.toBeInTheDocument()
    expect(screen.getByText('Beating')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'All players' }))
    expect(screen.getByText('Free Agent Guy')).toBeInTheDocument()
  })

  it('switches to the given-minutes mode, which hides pre-game-only sections', async () => {
    const fetchMock = stubApi({ pregame, retro })
    renderWithProviders(<ModelAccuracy />)
    await waitFor(() => expect(screen.getByText('Jaylen Brown')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Given actual minutes' }))

    await waitFor(() => expect(screen.getByText(/measures per-minute\s+skill only/)).toBeInTheDocument())
    expect(fetchMock.mock.calls.some(([u]) => String(u instanceof Request ? u.url : u).includes('mode=retro'))).toBe(true)
    expect(screen.queryByText('Jaylen Brown')).not.toBeInTheDocument()
    expect(await screen.findByText('Given')).toBeInTheDocument()
  })

  it('explains the empty state before any pre-game projection is graded', async () => {
    stubApi({ pregame: emptyPregame, retro })
    renderWithProviders(<ModelAccuracy />)

    await waitFor(() => expect(screen.getByText('No graded pre-game projections yet.')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'See given-minutes accuracy instead' }))
    await waitFor(() => expect(screen.getByText('Accuracy by category')).toBeInTheDocument())
  })
})
