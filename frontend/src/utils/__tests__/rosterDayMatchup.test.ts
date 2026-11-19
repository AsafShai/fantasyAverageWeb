import { describe, expect, it } from 'vitest'
import { rosterDayMatchup } from '../rosterDay'
import type { PlayerMatchup } from '../../types/api'

const m = (over: Partial<PlayerMatchup>) => ({ player_name: 'Tyler Herro', opponent: 'POR', game_date: '2026-11-19', ...over }) as PlayerMatchup
const today = { date: '2026-11-18', is_today: true }
const herro = { player_name: 'Tyler Herro', opponent: 'BOS' }

describe('rosterDayMatchup', () => {
  it("ignores the next slate's matchup once today's games are final", () => {
    expect(rosterDayMatchup(today, herro, new Map([['Tyler Herro', m({})]]))).toBeUndefined()
  })

  it("uses a matchup for the roster day's own date", () => {
    const own = m({ game_date: '2026-11-18', opponent: 'BOS' })
    expect(rosterDayMatchup(today, herro, new Map([['Tyler Herro', own]]))).toBe(own)
  })

  it('falls back to the opponent when the slate date is unknown', () => {
    expect(rosterDayMatchup(today, herro, new Map([['Tyler Herro', m({ game_date: null })]]))).toBeUndefined()
    const same = m({ game_date: null, opponent: 'BOS' })
    expect(rosterDayMatchup(today, herro, new Map([['Tyler Herro', same]]))).toBe(same)
  })

  it('never shows a matchup on a past day', () => {
    const own = m({ game_date: '2026-11-18', opponent: 'BOS' })
    expect(rosterDayMatchup({ ...today, is_today: false }, herro, new Map([['Tyler Herro', own]]))).toBeUndefined()
  })
})
