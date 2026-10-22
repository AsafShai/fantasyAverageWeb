import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import type { FormSurprises, NightSurprises, PeriodSurprises, SurpriseRow } from '../../types/api'
import BoomOrBust from '../BoomOrBust'

const row = (over: Partial<SurpriseRow>): SurpriseRow => ({
  game_date: '2024-01-05',
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

const period: PeriodSurprises = {
  start: '2023-12-30',
  end: '2024-01-05',
  nights: 2,
  games: 7,
  players_played: 120,
  players_scored: 100,
  players_with_estimate: 90,
  percentiles: { good: 97.5, bad: 97.5 },
  thresholds: { good: 1.4, bad: 1.2 },
  good: [
    row({ player_id: 31, player_name: 'Week Star', score: 2.9, game_date: '2024-01-04' }),
    row({ player_id: 32, player_name: 'Week Second', score: 2.1 }),
  ],
  bad: [row({ player_id: 41, player_name: 'Week Dud', score: -2.4, verdict: 'bad', game_date: '2024-01-04' })],
  computed_at: '2024-01-06T09:00:00Z',
}

// Form over the same period: one row per player, games and a combined score.
const form: FormSurprises = {
  start: '2023-12-30',
  end: '2024-01-05',
  nights: 2,
  games: 7,
  players_played: 60,
  players_scored: 50,
  players_with_estimate: 45,
  thresholds: { good: 1.8, bad: 1.8 },
  good: [
    row({ player_id: 51, player_name: 'Hot Streak', score: 2.3, avg_score: 1.6, games: 2, fantasy_team_id: 11, fantasy_team: 'HHT', fantasy_team_name: 'Trust the process' }),
    row({ player_id: 52, player_name: 'One Lucky Night', score: 2.6, avg_score: 2.6, games: 1, fantasy_team_id: 11, fantasy_team: 'HHT', fantasy_team_name: 'Trust the process' }),
    row({ player_id: 53, player_name: 'Free Riser', score: 0.4, avg_score: 0.3, games: 2, fantasy_team_id: null, fantasy_team: null }),
  ],
  bad: [
    row({ player_id: 61, player_name: 'Cold Spell', score: -2.0, avg_score: -1.4, games: 2, fantasy_team_id: 4, fantasy_team: 'LA', fantasy_team_name: 'DORELIT' }),
    row({ player_id: 62, player_name: 'Free Faller', score: -0.6, avg_score: -0.4, games: 2, fantasy_team_id: null, fantasy_team: null }),
  ],
  computed_at: '2024-01-06T09:00:00Z',
}

const requested = (part: string) =>
  vi.mocked(fetch).mock.calls
    .map(([input]) => (typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url))
    .filter((url) => url.includes(part))

function stubApi(latest: Response | (() => Response)) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/surprises/dates')) return Response.json(['2024-01-05', '2024-01-04'])
      if (url.includes('/surprises/team-nights')) {
        return Response.json([
          row({ player_id: 71, player_name: 'Team Big Night', score: 2.2, game_date: '2024-01-04', fantasy_team_id: 11, fantasy_team: 'HHT' }),
          row({ player_id: 71, player_name: 'Team Big Night', score: -0.3, game_date: '2024-01-05', fantasy_team_id: 11, fantasy_team: 'HHT' }),
        ])
      }
      if (url.includes('/surprises/form')) return Response.json(form)
      if (url.includes('/teams')) return Response.json([{ team_id: 11, team_name: 'Trust the process' }, { team_id: 4, team_name: 'DORELIT' }])
      if (url.includes('/surprises/period')) {
        const pct = Number(new URL(url, 'http://x').searchParams.get('good_pct'))
        return Response.json({ ...period, percentiles: { good: pct, bad: 97.5 }, good: pct >= 99 ? period.good.slice(0, 1) : period.good })
      }
      if (url.includes('/surprises/2024-01-04')) return Response.json({ ...night, game_date: '2024-01-04', latest_run: null })
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
    fireEvent.pointerUp(screen.getAllByLabelText('Surprise threshold')[0])
    await waitFor(() => expect(screen.queryByLabelText('Next page')).not.toBeInTheDocument())
    // ...and lowering it again starts on the first page, not back on page 2
    fireEvent.change(screen.getAllByLabelText('Surprise threshold')[0], { target: { value: '1.4' } })
    fireEvent.pointerUp(screen.getAllByLabelText('Surprise threshold')[0])
    await waitFor(() => expect(screen.getByText('1–5 of 7')).toBeInTheDocument())
    expect(screen.getByText('Boom 0')).toBeInTheDocument()
  })

  it('ranks a period by percentile: one row per player-night, each with its date', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(screen.getByText('Week Star')).toBeInTheDocument())
    expect(requested('/surprises/period').at(-1)).toContain('start=2023-12-30&end=2024-01-05&good_pct=97.5&bad_pct=97.5')
    expect(screen.getByText('Dec 30, 2023 – Jan 5, 2024')).toBeInTheDocument()
    expect(screen.getByText(/2 nights · 7 games · 100 player-nights scored/)).toBeInTheDocument()
    expect(screen.getByText('top 2.5%')).toBeInTheDocument()
    expect(screen.getByText('bottom 2.5%')).toBeInTheDocument()
    expect(screen.getAllByText('Jan 4').length).toBeGreaterThan(0)   // the Date column
    expect(screen.queryByLabelText('Previous night')).not.toBeInTheDocument()   // ‹ › are for single nights

    // the percentile slider asks the server again on release; top 1% = p99
    fireEvent.change(screen.getByLabelText('Surprise percentile'), { target: { value: '4' } })
    expect(screen.getByText('top 1%')).toBeInTheDocument()
    fireEvent.pointerUp(screen.getByLabelText('Surprise percentile'))
    await waitFor(() => expect(screen.queryByText('Week Second')).not.toBeInTheDocument())
    expect(requested('/surprises/period').at(-1)).toContain('good_pct=99')
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(screen.getByText('Week Second')).toBeInTheDocument())

    // back to one night: the score sliders return
    fireEvent.click(screen.getByRole('button', { name: 'Night' }))
    await waitFor(() => expect(screen.getByLabelText('Surprise threshold')).toBeInTheDocument())
  })

  it('a one-day custom range is that night, with the score sliders', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue('2023-12-30'))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-01-04' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2024-01-04' } })
    await waitFor(() => expect(screen.getByText(/Thursday, Jan 4, 2024/)).toBeInTheDocument())
    expect(screen.getByLabelText('Surprise threshold')).toBeInTheDocument()
    expect(requested('/surprises/2024-01-04').length).toBeGreaterThan(0)
  })

  it('form: one row per player, Min GP 2 by default, its own sliders', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    fireEvent.click(await screen.findByRole('button', { name: '📈 Form' }))
    await waitFor(() => expect(screen.getByText('Hot Streak')).toBeInTheDocument())
    expect(requested('/surprises/form').at(-1)).toContain('start=2023-12-30&end=2024-01-05')
    // two steady nights make form; one lucky night doesn't, at the default Min GP 2
    expect(screen.queryByText('One Lucky Night')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'At least 2 games' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText('GP', { selector: 'th' }).length).toBeGreaterThan(0)
    expect(screen.getByText('avg +1.6')).toBeInTheDocument()
    expect(screen.getByText('Cold Spell')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'At least 1 game' }))
    expect(screen.getByText('One Lucky Night')).toBeInTheDocument()
    expect(screen.queryByText('avg +2.6')).not.toBeInTheDocument()   // one game: the avg would just repeat the score
    // Min GP 5: nobody has that many games yet, and the card says so plainly
    fireEvent.click(screen.getByRole('button', { name: 'At least 5 games' }))
    expect(screen.getAllByText(/No player has 5\+ games in this period yet/)).toHaveLength(2)
  })

  it('by team: one team\'s players, or the best and worst free agents, under the tables', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    fireEvent.click(await screen.findByRole('button', { name: '📈 Form' }))
    await waitFor(() => expect(screen.getByText('Hot Streak')).toBeInTheDocument())
    const pickTeam = screen.getByLabelText('Fantasy team')
    await waitFor(() => expect(screen.getByRole('option', { name: 'Trust the process' })).toBeInTheDocument())
    fireEvent.change(pickTeam, { target: { value: '11' } })
    expect(screen.getByText('🏀 By team')).toHaveTextContent('(2)')
    expect(screen.getAllByText('One Lucky Night').length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText('Boom').length).toBeGreaterThan(0)   // Hot Streak is also in the In form list
    fireEvent.change(pickTeam, { target: { value: 'fa' } })
    expect(screen.getByText(/Best 5/)).toBeInTheDocument()
    expect(screen.getByText('Free Riser')).toBeInTheDocument()
    expect(screen.getByText('Free Faller')).toBeInTheDocument()
  })

  it('by team follows the view: a period of biggest nights lists the team\'s nights', async () => {
    stubApi(() => Response.json(night))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText('Good Guy')).toBeInTheDocument())
    expect(screen.getByText('that night')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await waitFor(() => expect(screen.getByText('Week Star')).toBeInTheDocument())
    expect(screen.getByText('one row per night')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('option', { name: 'Trust the process' })).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('Fantasy team'), { target: { value: '11' } })
    // both of his nights, each with its date: one row per player-night
    await waitFor(() => expect(screen.getAllByText('Team Big Night')).toHaveLength(2))
    expect(requested('/surprises/team-nights').at(-1)).toContain('start=2023-12-30&end=2024-01-05&team=11')
    expect(screen.getByText('🏀 By team')).toHaveTextContent('(2)')
    fireEvent.click(screen.getByRole('button', { name: '📈 Form' }))
    await waitFor(() => expect(screen.getByText('per player · averaged over the period')).toBeInTheDocument())
  })

  it('shows the empty state on 404', async () => {
    stubApi(() => new Response('not found', { status: 404 }))
    renderWithProviders(<BoomOrBust />, { route: '/boom-or-bust' })
    await waitFor(() => expect(screen.getByText(/No nights scored yet/)).toBeInTheDocument())
  })
})
