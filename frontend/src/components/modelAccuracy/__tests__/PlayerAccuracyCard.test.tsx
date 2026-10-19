import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlayerAccuracy } from '../../../types/api'
import { renderWithProviders } from '../../../test/helpers'
import PlayerAccuracyCard from '../PlayerAccuracyCard'

const detail: PlayerAccuracy = {
  player_id: 4432166,
  player_name: 'Cade Cunningham',
  games: [0.9, 1.4, -0.4, 1.1, 0.6, 1.8, -0.3, 1.2].map((z, i) => ({
    game_date: `2026-12-0${i + 1}`, opponent_team_id: 1, opponent: 'ATL', z, proj_pts: 25.7, actual_pts: 29, proj_min: 34.9, actual_min: 36.2,
  })),
  categories: [
    { key: 'pts', label: 'PTS', proj: 25.7, actual: 28.9 },
    { key: 'fg_pct', label: 'FG%', proj: 45.1, actual: 47.3 },
    { key: 'ft_pct', label: 'FT%', proj: 86.0, actual: null },
  ],
  proj_min: 34.9,
  actual_min: 37.2,
  beat_count: 6,
  flag: 'up',
}

function stub(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
}

describe('PlayerAccuracyCard', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('summarizes the last graded games against projection', async () => {
    stub(200, detail)
    renderWithProviders(<PlayerAccuracyCard playerId={4432166} />)

    await waitFor(() => expect(screen.getByText('Model vs. Reality')).toBeInTheDocument())
    expect(screen.getByText(/Beating projections in 6 of the last 8\./)).toBeInTheDocument()
    expect(screen.getByText('37.2 played vs 34.9 projected')).toBeInTheDocument()
    expect(screen.getByText('+3.2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Last 8 games vs projection' })).toBeInTheDocument()
  })

  it('renders nothing for a player with no graded projections', async () => {
    const fetchMock = vi.fn(async () => new Response('{"detail":"none"}', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { container } = renderWithProviders(<PlayerAccuracyCard playerId={1} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
