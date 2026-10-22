import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.getByLabelText('Score scale')).toHaveTextContent('Usual')
    expect(screen.getByLabelText('Score scale')).toHaveTextContent('Around his usual game')
    expect(screen.getByLabelText('Score scale')).toHaveTextContent('≤ −1.8')
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

    // (b) while dragging only the label follows; the row appears when the thumb is released
    fireEvent.change(screen.getByLabelText('Surprise threshold'), { target: { value: '1.4' } })
    expect(screen.getByText('score ≥ 1.4')).toBeInTheDocument()
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(1)')
    fireEvent.pointerUp(screen.getByLabelText('Surprise threshold'))
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
    const many = Array.from({ length: 12 }, (_, i) => row({ player_id: 100 + i, player_name: `Boom ${i}`, score: 2.4 - i * 0.05 }))
    stubApi(() => Response.json({ ...night, good: many }))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Boom 0')).toBeInTheDocument())
    expect(screen.getByText('Boom 4')).toBeInTheDocument()
    expect(screen.queryByText('Boom 5')).not.toBeInTheDocument()
    expect(screen.getByText('1–5 of 12')).toBeInTheDocument()
    // the busts card has two rows: no pager there
    expect(screen.getAllByLabelText('Next page')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(screen.getByText('Boom 5')).toBeInTheDocument()
    expect(screen.queryByText('Boom 0')).not.toBeInTheDocument()
    expect(screen.getByText('6–10 of 12')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Next page'))
    expect(screen.getByText('Boom 11')).toBeInTheDocument()
    expect(screen.getByText('11–12 of 12')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()   // the rank keeps counting on the last page
    // raising the bar under the viewer drops the list to one page: the card falls back to it
    fireEvent.change(screen.getAllByLabelText('Surprise threshold')[0], { target: { value: '2.2' } })
    fireEvent.pointerUp(screen.getAllByLabelText('Surprise threshold')[0])
    await waitFor(() => expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument())
    // ...and lowering it again starts on the first page, not back on page 2
    fireEvent.change(screen.getAllByLabelText('Surprise threshold')[0], { target: { value: '1.4' } })
    fireEvent.pointerUp(screen.getAllByLabelText('Surprise threshold')[0])
    await waitFor(() => expect(screen.getByText('1–5 of 12')).toBeInTheDocument())
    expect(screen.getByText('Boom 0')).toBeInTheDocument()
  })

  it('averages a 7, 14, or 28 day span by games played', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/surprises/dates')) return Response.json(['2024-01-05', '2024-01-04'])
        if (url.includes('/surprises/range')) {
          const days = new URL(url, 'http://localhost').searchParams.get('days')
          const name = days === '14' ? 'Fortnight Guy' : 'Week Guy'
          return Response.json({
            ...night,
            days: Number(days),
            start_date: '2023-12-30',
            game_date: '2024-01-05',
            games: 9,
            players_played: 40,
            players_scored: 30,
            players_with_estimate: 20,
            good: [
              row({ player_id: 30, player_name: 'One Game', score: 2.6, games: 1, reasons: [] }),
              row({ player_id: 31, player_name: name, score: 2.1, games: 4, pts: 22.5, minutes: 31.5, reasons: [] }),
              row({ player_id: 33, player_name: 'Quiet Week', score: 1.2, games: 2, reasons: [] }),
              row({ player_id: 34, player_name: 'Extra', score: 0.5, games: 5, reasons: [] }),
            ],
            bad: [
              row({ player_id: 32, player_name: 'Span Bust', score: -2.4, games: 3, reasons: [] }),
              row({ player_id: 35, player_name: 'Mild', score: -0.4, games: 1, reasons: [] }),
            ],
          })
        }
        if (url.includes('/surprises/latest')) return Response.json(night)
        return new Response('not found', { status: 404 })
      }),
    )
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '7 days' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('group', { name: 'Minimum games' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Top 3' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Top 3' }))
    expect(screen.queryByLabelText('Surprise threshold')).not.toBeInTheDocument()
    expect(screen.getByText('Almost Good')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Slider' }))
    expect(screen.getByLabelText('Surprise threshold')).toBeInTheDocument()
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(screen.getByText('Week Guy')).toBeInTheDocument())
    expect(screen.queryByLabelText('Scored night')).not.toBeInTheDocument()
    expect(screen.queryByText('Good Guy')).not.toBeInTheDocument()
    expect(screen.queryByText('vs LAL')).not.toBeInTheDocument()
    expect(screen.getByText('One Game')).toBeInTheDocument()
    expect(screen.queryByText('Quiet Week')).not.toBeInTheDocument()
    expect(screen.getByText('Span Bust')).toBeInTheDocument()
    expect(screen.queryByText('Mild')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'At least 2 games' }))
    expect(screen.queryByText('One Game')).not.toBeInTheDocument()
    expect(screen.getByText('Week Guy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Top 3' }))
    expect(screen.getByText('Quiet Week')).toBeInTheDocument()
    expect(screen.getByText('Extra')).toBeInTheDocument()
    expect(screen.queryByLabelText('Surprise threshold')).not.toBeInTheDocument()
    expect(screen.getByText('💥 Booms')).toHaveTextContent('(3)')

    fireEvent.click(screen.getByRole('button', { name: 'Slider' }))
    expect(screen.queryByText('Quiet Week')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Surprise threshold')).toBeInTheDocument()
    expect(screen.getByText('22.5')).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader', { name: 'GP' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/Dec 30, 2023 – Jan 5, 2024 · 7 days · 9 games/)).toBeInTheDocument()
    expect(screen.getByText(/divided by the games he played/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '14 days' }))
    await waitFor(() => expect(screen.getByText('Fortnight Guy')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Night' }))
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    expect(screen.getByLabelText('Scored night')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous night' })).not.toBeInTheDocument()
    expect(screen.getAllByText('vs LAL').length).toBeGreaterThan(0)
    expect(screen.queryByRole('group', { name: 'Minimum games' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Top 3' })).toBeInTheDocument()
  })

  it('opens a scored night from the night menu and keeps ranges on the latest window', async () => {
    const older = {
      ...night,
      game_date: '2024-01-04',
      latest_run: null,
      good: [row({ player_id: 41, player_name: 'Older Guy', score: 2.2 })],
      bad: [],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/surprises/dates')) return Response.json(['2024-01-05', '2024-01-04'])
        if (url.includes('/surprises/latest')) return Response.json(night)
        if (url.includes('/surprises/2024-01-04')) return Response.json(older)
        if (url.includes('/surprises/range')) return Response.json({ ...night, days: 7, start_date: '2023-12-30', games: 9, good: [row({ player_id: 31, player_name: 'Week Guy', score: 2.1, games: 4, reasons: [] })], bad: [] })
        return new Response('not found', { status: 404 })
      }),
    )
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByLabelText('Scored night')).toHaveValue('2024-01-05'))
    expect(screen.getByRole('option', { name: 'Latest · Friday, Jan 5, 2024' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Scored night'), { target: { value: '2024-01-04' } })
    await waitFor(() => expect(screen.getByText('Older Guy')).toBeInTheDocument())
    expect(screen.queryByText('Good Guy')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(screen.getByText('Week Guy')).toBeInTheDocument())
    expect(screen.queryByLabelText('Scored night')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Night' }))
    await waitFor(() => expect(screen.getByText('Older Guy')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Scored night'), { target: { value: '2024-01-05' } })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
  })

  it('lists a chosen fantasy team and marks players who are also booms or busts', async () => {
    const teamNight: NightSurprises = {
      ...night,
      good: [
        row({ player_id: 11, player_name: 'Good Guy', score: 2.4, fantasy_team: 'DOR', fantasy_team_id: 8 }),
        row({ player_id: 12, player_name: 'Almost Good', score: 1.5, fantasy_team: 'DOR', fantasy_team_id: 8, verdict: '' }),
      ],
      bad: [
        row({ player_id: 22, player_name: 'Bad Guy', score: -2.1, fantasy_team: 'AAT', fantasy_team_id: 1, verdict: 'bad', has_estimate: false }),
      ],
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.includes('/surprises/dates')) return Response.json(['2024-01-05'])
        if (url.includes('/teams')) return Response.json([{ team_id: 8, team_name: "Dor's Injured Team" }, { team_id: 1, team_name: "Asaf's Astounding Team" }])
        if (url.includes('/surprises/latest')) return Response.json(teamNight)
        return new Response('not found', { status: 404 })
      }),
    )
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'Boom or Bust', selected: true })).toBeInTheDocument()
    expect(screen.queryByLabelText('Fantasy team')).not.toBeInTheDocument()
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'By team' }))
    expect(screen.queryByRole('group', { name: 'List mode' })).not.toBeInTheDocument()
    expect(screen.getByText('Select a team to see every scored player on it.')).toBeInTheDocument()
    expect(screen.queryByText('Good Guy')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Boom')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: "Dor's Injured Team" })).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Fantasy team'), { target: { value: '8' } })
    expect(screen.getByText('Almost Good')).toBeInTheDocument()
    expect(screen.getByText('Good Guy')).toBeInTheDocument()
    expect(screen.getByLabelText('Boom')).toBeInTheDocument()
    expect(screen.queryByLabelText('Bust')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Fantasy team'), { target: { value: '1' } })
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Bust')).toBeInTheDocument()
    expect(screen.getByText('Bad Guy')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Boom or Bust' }))
    expect(screen.getByRole('group', { name: 'List mode' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Fantasy team')).not.toBeInTheDocument()
    expect(screen.getByText('Good Guy')).toBeInTheDocument()
    expect(screen.queryByText('Almost Good')).not.toBeInTheDocument()
  })

  it('shows the five strongest and five weakest free agents when FA is chosen', async () => {
    const fa = (id: number, name: string, score: number): SurpriseRow =>
      row({ player_id: id, player_name: name, score, fantasy_team: null, fantasy_team_id: null, lineup_slot: null, started: null, verdict: score >= 1.8 ? 'good' : score <= -1.8 ? 'bad' : '' })
    const faNight: NightSurprises = {
      ...night,
      good: [
        fa(1, 'FA One', 3),
        fa(2, 'FA Two', 2),
        fa(3, 'FA Three', 1),
        fa(4, 'FA Four', 0.5),
        fa(5, 'FA Five', 0.2),
        fa(6, 'FA Cut Up', 0.1),
        row({ player_id: 99, player_name: 'Owned Guy', score: 4, fantasy_team: 'DOR', fantasy_team_id: 8 }),
      ],
      bad: [
        fa(11, 'FA Worst', -3),
        fa(12, 'FA Low', -2),
        fa(13, 'FA Mild', -1),
        fa(14, 'FA Soft', -0.5),
        fa(15, 'FA Edge', -0.2),
        fa(16, 'FA Cut Down', -0.1),
      ],
    }
    stubApi(() => Response.json(faNight))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('FA One')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('tab', { name: 'By team' }))
    await waitFor(() => expect(screen.getByRole('option', { name: 'FA' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Fantasy team'), { target: { value: 'fa' } })

    const top = screen.getByRole('region', { name: 'Top 5' })
    const bottom = screen.getByRole('region', { name: 'Bottom 5' })
    for (const name of ['FA One', 'FA Two', 'FA Three', 'FA Four', 'FA Five']) {
      expect(within(top).getByText(name)).toBeInTheDocument()
    }
    for (const name of ['FA Worst', 'FA Low', 'FA Mild', 'FA Soft', 'FA Edge']) {
      expect(within(bottom).getByText(name)).toBeInTheDocument()
    }
    expect(within(top).queryByText('FA Worst')).not.toBeInTheDocument()
    expect(within(bottom).queryByText('FA One')).not.toBeInTheDocument()
    expect(screen.queryByText('FA Cut Up')).not.toBeInTheDocument()
    expect(screen.queryByText('FA Cut Down')).not.toBeInTheDocument()
    expect(screen.queryByText('Owned Guy')).not.toBeInTheDocument()
    expect(within(top).getAllByLabelText('Boom')).toHaveLength(2)
    expect(within(bottom).getAllByLabelText('Bust')).toHaveLength(2)
  })

  it('shows the empty state on 404', async () => {
    stubApi(() => new Response('not found', { status: 404 }))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText(/No nights scored yet/)).toBeInTheDocument())
  })
})
