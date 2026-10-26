import { screen } from '@testing-library/react'
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

describe('TeamScheduleView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-10-26T16:00:00Z'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(schedule), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
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
})
