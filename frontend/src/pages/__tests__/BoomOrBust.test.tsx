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
  has_estimate: true, fantasy_team: 'DOR', lineup_slot: 'SF', started: true,
  reasons: [{ stat: 'PTS', value: 31, avg: 18.2, z: 2.5 }],
  verdict: 'good',
  ...over,
})

const night: NightSurprises = {
  latest_run: { game_date: '2024-01-06', status: 'no_games' },
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
    row({ player_id: 12, player_name: 'Almost Good', score: 1.5, verdict: '' }),
  ],
  bad: [
    row({ player_id: 22, player_name: 'Bad Guy', score: -2.1, verdict: 'bad', has_estimate: false, reasons: [{ stat: 'FG_PCT', value: 0.25, avg: null, z: -2 }] }),
    row({ player_id: 23, player_name: 'Almost Bad', score: -1.5, verdict: '' }),
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
    expect(screen.queryByText('31 PTS (avg 18.2)')).not.toBeInTheDocument()   // no stat text by the name either
    expect(screen.queryByText('25% FG%')).not.toBeInTheDocument()   // no stat text by the name: the cells carry the colour
    expect(screen.getAllByText('53%').length).toBeGreaterThan(0)   // 8-15 FG as a percentage
    expect(screen.getAllByText('history only')).toHaveLength(1)
    expect(screen.getByText(/Friday, Jan 5, 2024 · 3 games · 50 of 60 players scored · 40 with a model estimate/)).toBeInTheDocument()
    expect(screen.getByText(/No games on Jan 6, 2024 — showing the latest night with results \(Jan 5, 2024\)/)).toBeInTheDocument()
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
    fireEvent.change(screen.getByLabelText('Surprise threshold'), { target: { value: '1.4' } })
    expect(screen.getByText('Almost Good')).toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(2)')
    expect(screen.getByText('score ≥ 1.4')).toBeInTheDocument()
    expect(screen.queryByText('Almost Bad')).not.toBeInTheDocument()
    expect(localStorage.getItem('boomOrBust.goodThreshold')).toBe('1.4')

    // (c) Reset restores the server default and clears the stored value
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(1)')
    expect(screen.getByText('score ≥ 1.8')).toBeInTheDocument()
    expect(localStorage.getItem('boomOrBust.goodThreshold')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument()
  })

  it('a stored threshold wins over the server default on load', async () => {
    localStorage.setItem('boomOrBust.badThreshold', '1.4')
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Almost Bad')).toBeInTheDocument())
    expect(screen.getByText('💩 Busts')).toHaveTextContent('(2)')
    expect(screen.getByText('score ≤ −1.4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
  })

  it('pages a card five at a time, only when there are more than five', async () => {
    const many = Array.from({ length: 7 }, (_, i) => row({ player_id: 100 + i, player_name: `Boom ${i}`, score: 2.6 - i * 0.1 }))
    stubApi(() => Response.json({ ...night, good: many }))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Boom 0')).toBeInTheDocument())
    expect(screen.getByText('Boom 4')).toBeInTheDocument()
    expect(screen.queryByText('Boom 5')).not.toBeInTheDocument()
    expect(screen.getByText('1–5 of 7')).toBeInTheDocument()
    // the busts card has two rows: no pager there
    expect(screen.getAllByLabelText('Next page')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(screen.getByText('Boom 6')).toBeInTheDocument()
    expect(screen.queryByText('Boom 0')).not.toBeInTheDocument()
    expect(screen.getByText('6–7 of 7')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()   // the rank keeps counting on the second page
    // raising the bar under the viewer drops the list to one page: the card falls back to it
    fireEvent.change(screen.getAllByLabelText('Surprise threshold')[0], { target: { value: '2.2' } })
    await waitFor(() => expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument())
  })

  it('shows the empty state on 404', async () => {
    stubApi(() => new Response('not found', { status: 404 }))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText(/No nights scored yet/)).toBeInTheDocument())
  })
})
