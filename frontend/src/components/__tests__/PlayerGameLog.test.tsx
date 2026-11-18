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
    usg: 24.6,
    ...overrides,
  }
}

function log(games: PlayerGameLogGame[]): PlayerGameLogResponse {
  return {
    player_id: 3975,
    current_season: '2026-27',
    games,
    categories: ['PTS'],
    reverse_categories: [],
    nights: [{
      date: '2026-10-28',
      players: [
        { player_id: '3975', game_id: '401', name: 'Test', position: 'G', stats: { MIN: 20, PTS: 10 } },
        { player_id: '2', game_id: '999', name: 'Other', position: 'F', stats: { MIN: 30, PTS: 30 } },
      ],
    }],
  }
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
    expect(screen.getByRole('columnheader', { name: 'USG%' })).toBeInTheDocument()
    expect(screen.getAllByText('24.6%').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '2025-26' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  })

  it('shows the fantasy team and lineup from that night at the end of the row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input)
        if (url.includes('/nba-players/3975/games')) {
          return new Response(
            JSON.stringify(log([
              game({
                fantasy: { fantasy_team: 'TTP', fantasy_team_name: 'Trust the process', lineup_slot: 'SG', started: true },
              }),
              game({
                game_id: '402',
                game_date: '2026-11-01',
                opponent: 'BOS',
                fantasy: { fantasy_team: null, fantasy_team_name: null, lineup_slot: null, started: null },
              }),
            ])),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return new Response('not found', { status: 404 })
      }),
    )
    renderWithProviders(<PlayerGameLog playerId="3975" />)
    expect(await screen.findByRole('button', { name: 'TTP: Trust the process' })).toBeInTheDocument()
    expect(screen.getByLabelText('active lineup')).toBeInTheDocument()
    expect(screen.getByText('FA')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Fantasy' })).toBeInTheDocument()
  })
})
