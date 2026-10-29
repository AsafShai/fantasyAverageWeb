import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../../test/helpers'
import type { PlayerGameLogGame, PlayerGameLogResponse } from '../../types/api'
import PlayerGameLog from '../PlayerGameLog'

function game(overrides: Partial<PlayerGameLogGame>): PlayerGameLogGame {
  return {
    game_id: '401',
    season: '2026-27',
    game_date: '2026-10-28',
    opponent: 'LAL',
    is_home: true,
    team_pts: 112,
    opp_pts: 104,
    minutes: 32,
    pts: 28,
    reb: 6,
    ast: 5,
    stl: 1,
    blk: 0,
    tov: 3,
    fg3m: 4,
    fg3a: 9,
    fgm: 10,
    fga: 18,
    ftm: 4,
    fta: 4,
    plus_minus: 12,
    ...overrides,
  }
}

function log(games: PlayerGameLogGame[]): PlayerGameLogResponse {
  return { player_id: 3975, current_season: '2026-27', games }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return (input as Request).url
}

describe('PlayerGameLog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input)
        if (url.includes('/nba-players/3975/games')) {
          return new Response(
            JSON.stringify(log([
              game({}),
              game({
                game_id: '300',
                season: '2025-26',
                game_date: '2026-01-02',
                opponent: 'BOS',
                is_home: false,
                team_pts: 98,
                opp_pts: 110,
              }),
            ])),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows only the current season and links the opponent to the box score', async () => {
    renderWithProviders(<PlayerGameLog playerId="3975" />)
    expect(await screen.findByRole('link', { name: /vs LAL/ })).toHaveAttribute(
      'href',
      '/box-scores?date=2026-10-28&game=401',
    )
    expect(screen.getByText('W')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /@ BOS/ })).not.toBeInTheDocument()
    expect(screen.getByText(/2026-27 · 1 game/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '2025-26' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })
})
