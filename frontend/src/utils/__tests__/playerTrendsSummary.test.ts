import { describe, expect, it } from 'vitest'
import type { GameLogEntry, GameLogResponse } from '../../types/api'
import { fmtDelta, fmtValue, seasonAttempts, summarize } from '../playerTrendsSummary'

function game(overrides: Partial<GameLogEntry>): GameLogEntry {
  return {
    game_date: '2026-01-01',
    matchup: 'vs BOS',
    min: 30,
    usg: 20,
    fgm: 5,
    fga: 10,
    ftm: 2,
    fta: 2,
    fg3m: 1,
    fg3a: 3,
    ...overrides,
  }
}

function log(overrides: Partial<GameLogResponse>): GameLogResponse {
  return {
    player_id: 1,
    player_name: 'Test Player',
    season: '2025-26',
    window_days: 15,
    window_start: '2026-01-10',
    season_gp: 10,
    season_mpg: 28,
    season_usg: 22,
    season_pct: { '3P%': 35, 'FT%': 80, 'FG%': 45 },
    baseline_pct: {},
    league_pct: {},
    league_usg: null,
    baseline_seasons: 0,
    games: [],
    ...overrides,
  }
}

describe('summarize', () => {
  it('averages minutes over the window and computes delta vs season', () => {
    const l = log({
      games: [
        game({ game_date: '2026-01-05', min: 20 }),
        game({ game_date: '2026-01-11', min: 30 }),
        game({ game_date: '2026-01-13', min: 34 }),
      ],
    })
    const s = summarize(l, 'minutes')
    expect(s.seasonValue).toBe(28)
    expect(s.windowValue).toBe(32)
    expect(s.delta).toBeCloseTo(4)
    expect(s.windowGames).toBe(2)
    expect(s.seasonGames).toBe(10)
    expect(s.windowStart).toBe('2026-01-10')
  })

  it('pools makes over attempts for a shooting stat rather than averaging per-game percentages', () => {
    const l = log({
      games: [
        game({ game_date: '2026-01-11', fg3m: 1, fg3a: 2 }), // 50%
        game({ game_date: '2026-01-12', fg3m: 4, fg3a: 8 }), // 50%
        game({ game_date: '2026-01-13', fg3m: 0, fg3a: 0 }), // no attempts, excluded from pooling but counted as a game
      ],
    })
    const s = summarize(l, '3P%')
    expect(s.windowValue).toBeCloseTo(50)
    expect(s.windowGames).toBe(3)
    expect(s.seasonValue).toBe(35)
    expect(s.delta).toBeCloseTo(15)
  })

  it('returns null window value when no games fall in the window', () => {
    const l = log({ games: [game({ game_date: '2025-12-01' })] })
    const s = summarize(l, 'minutes')
    expect(s.windowValue).toBeNull()
    expect(s.delta).toBeNull()
    expect(s.windowGames).toBe(0)
  })

  it('returns null window value for a shooting stat with zero attempts in the window', () => {
    const l = log({
      games: [game({ game_date: '2026-01-11', fg3m: 0, fg3a: 0 })],
    })
    const s = summarize(l, '3P%')
    expect(s.windowValue).toBeNull()
    expect(s.delta).toBeNull()
  })
})

describe('seasonAttempts', () => {
  it('sums attempts for the given stat across all games', () => {
    const games = [game({ fg3a: 3 }), game({ fg3a: 5 })]
    expect(seasonAttempts(games, '3P%')).toBe(8)
  })

  it('returns 0 when no games have attempts', () => {
    const games = [game({ fta: 0 })]
    expect(seasonAttempts(games, 'FT%')).toBe(0)
  })
})

describe('fmtValue / fmtDelta', () => {
  it('formats minutes without a percent sign', () => {
    expect(fmtValue(28.456, 'minutes')).toBe('28.5')
  })

  it('formats usage and shooting stats with a percent sign', () => {
    expect(fmtValue(22.1, 'usage')).toBe('22.1%')
    expect(fmtValue(35, '3P%')).toBe('35.0%')
  })

  it('formats null as an em dash', () => {
    expect(fmtValue(null, 'minutes')).toBe('—')
    expect(fmtDelta(null, '3P%')).toBe('—')
  })

  it('signs deltas explicitly', () => {
    expect(fmtDelta(4, 'minutes')).toBe('+4.0')
    expect(fmtDelta(-2.3, 'usage')).toBe('-2.3%')
  })
})
