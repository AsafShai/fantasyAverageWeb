import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import type { NightSurprises, SurpriseRow } from '../../types/api'
import BoomOrBust from '../BoomOrBust'

const row = (over: Partial<SurpriseRow>): SurpriseRow => ({
  player_id: 1,
  player_name: 'Player',
  team_abbr: 'BOS',
  opponent_abbr: 'LAL',
  is_home: true,
  minutes: 34.2,
  pts: 20, reb: 5, ast: 4, fg3m: 2, stl: 1, blk: 0,
  fgm: 8, fga: 15, ftm: 2, fta: 2,
  score: 2.4,
  metric_z: 2.0,
  metric_err: 1.0,
  has_estimate: true,
  reasons: [{ stat: 'PTS', value: 31, avg: 18.2, z: 2.5 }],
  verdict: 'good',
  ...over,
})

const night: NightSurprises = {
  game_date: '2024-01-05',
  games: 3,
  players_played: 60,
  players_scored: 50,
  players_with_estimate: 40,
  thresholds: { good: 1.8, bad: 1.8 },
  max_rows: 25,
  // Every scored row, best first / worst first — the page filters by its own sliders.
  good: [
    row({ player_id: 11, player_name: 'Good Guy', score: 2.4 }),
    row({ player_id: 12, player_name: 'Almost Good', score: 1.2, verdict: '' }),
  ],
  bad: [
    row({ player_id: 22, player_name: 'Bad Guy', score: -2.1, verdict: 'bad', has_estimate: false, reasons: [{ stat: 'FG_PCT', value: 0.25, avg: null, z: -2 }] }),
    row({ player_id: 23, player_name: 'Almost Bad', score: -1.1, verdict: '' }),
  ],
  computed_at: '2024-01-06T09:00:00Z',
}

function stubApi(latest: Response | (() => Response)) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/surprises/dates')) return Response.json(['2024-01-05', '2024-01-04'])
      if (url.includes('/surprises/latest')) return typeof latest === 'function' ? latest() : latest
      return new Response('not found', { status: 404 })
    }),
  )
}

describe('Boom or Bust page', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('renders surprises, disappointments and the stale-night banner', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    expect(screen.getByText('Bad Guy')).toBeInTheDocument()
    expect(screen.getByText('31 PTS (avg 18.2)')).toBeInTheDocument()
    expect(screen.getByText('25% FG%')).toBeInTheDocument()
    expect(screen.getAllByText('history only')).toHaveLength(1)
    expect(screen.getByText(/Friday, Jan 5, 2024 · 3 games · 50 of 60 players scored · 40 with a model estimate/)).toBeInTheDocument()
    expect(screen.getByText(/No games last night — showing the latest night with results \(Jan 5, 2024\)/)).toBeInTheDocument()
  })

  it('filters each list by its slider and remembers the value', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())

    // (a) default thresholds hide the rows below the bar
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()
    expect(screen.queryByText('Almost Bad')).not.toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(1)')
    expect(screen.getByText('score ≥ 1.8')).toBeInTheDocument()
    expect(screen.getByText('score ≤ −1.8')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()

    // (b) moving the good slider down reveals the row and updates the count
    fireEvent.change(screen.getByLabelText('Surprise threshold'), { target: { value: '1.0' } })
    expect(screen.getByText('Almost Good')).toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(2)')
    expect(screen.getByText('score ≥ 1.0')).toBeInTheDocument()
    expect(screen.queryByText('Almost Bad')).not.toBeInTheDocument()
    expect(localStorage.getItem('boomOrBust.goodThreshold')).toBe('1.0')

    // (c) Reset restores the server default and clears the stored value
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(1)')
    expect(screen.getByText('score ≥ 1.8')).toBeInTheDocument()
    expect(localStorage.getItem('boomOrBust.goodThreshold')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('a stored threshold wins over the server default on load', async () => {
    localStorage.setItem('boomOrBust.badThreshold', '1.0')
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Almost Bad')).toBeInTheDocument())
    expect(screen.getByText('💩 Busts')).toHaveTextContent('(2)')
    expect(screen.getByText('score ≤ −1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('shows the empty state on 404', async () => {
    stubApi(() => new Response('not found', { status: 404 }))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText(/No nights scored yet/)).toBeInTheDocument())
  })
})
