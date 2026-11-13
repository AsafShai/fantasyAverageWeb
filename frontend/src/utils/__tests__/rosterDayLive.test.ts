import { describe, expect, it } from 'vitest'
import type { LiveBlock, RosterDay, RosterDayGame, RosterDayPlayer } from '../../types/api'
import { gameLabel, liveRosterMoment, rosterDayNote, startersPlayingNow, starterTotals } from '../rosterDay'

const stats = (pts: number, minutes = 20) => ({
  minutes, fgm: 3, fga: 8, ftm: 1, fta: 2, three_pm: 0, reb: 5, ast: 3, stl: 2, blk: 1, pts, to: 1,
})
const player = (over: Partial<RosterDayPlayer>): RosterDayPlayer => ({
  player_id: 1, player_name: 'P', positions: ['SF'], pro_team: 'DET', lineup_slot: 'SF',
  opponent: 'WAS', status: 'live', stats: stats(7), added: false, dropped: false, ...over,
})
const LIVE: LiveBlock = { active: true, period: 24, as_of: '2026-11-13T01:42:00Z', games_total: 4, games_live: 2, games_final: 1, official_updated_at: null }
const FINAL: LiveBlock = { ...LIVE, games_live: 0, games_final: 4 }
const day = (over: Partial<RosterDay>): RosterDay => ({
  team_id: 1, date: '2026-11-12', scoring_period_id: 24, is_today: true, has_games: true,
  lock_at: '2026-11-13T00:00:00Z', first_date: '2026-10-20', last_date: '2026-11-12', players: [], moves: [], ...over,
})
const game = (over: Partial<RosterDayGame>): RosterDayGame => ({
  status: 'final', detail: 'Final', start_time: '2026-11-13T00:00:00Z', team_score: 112, opp_score: 104, won: true, ...over,
})

describe('live roster day', () => {
  it('is live only for today with an active live block', () => {
    expect(liveRosterMoment(day({ live: LIVE }))).toBe('live')
    expect(liveRosterMoment(day({ live: FINAL }))).toBe('final')
    expect(liveRosterMoment(day({}))).toBeNull()
    expect(liveRosterMoment(day({ live: { ...LIVE, active: false } }))).toBeNull()
    expect(liveRosterMoment(day({ live: LIVE, is_today: false }))).toBeNull()
  })

  it('counts starters on court, not bench or players yet to check in', () => {
    const players = [
      player({ player_id: 1 }),
      player({ player_id: 2, lineup_slot: 'F' }),
      player({ player_id: 3, lineup_slot: 'IR' }),
      player({ player_id: 4, stats: null }),
      player({ player_id: 5, status: 'played' }),
    ]
    expect(startersPlayingNow(day({ players }))).toBe(2)
  })

  it('says what the day is doing', () => {
    const players = [player({ player_id: 1 }), player({ player_id: 2, lineup_slot: 'F' })]
    expect(rosterDayNote(day({ live: LIVE, players }))).toBe('Live · 2 starters playing now')
    expect(rosterDayNote(day({ live: LIVE, players: players.slice(0, 1) }))).toBe('Live · 1 starter playing now')
    expect(rosterDayNote(day({ live: FINAL, players }))).toBe('Final · ESPN official pending')
    // Before tip-off and with the flag off: the lock note, as before.
    expect(rosterDayNote(day({}), new Date('2026-11-12T20:00:00Z'))).toMatch(/^Live · locks /)
  })

  it('totals include tonight so far', () => {
    const totals = starterTotals([player({ stats: stats(7) }), player({ status: 'played', stats: stats(12) }), player({ lineup_slot: 'BE', stats: stats(4) })])
    expect(totals.games).toBe(2)
    expect(totals.pts).toBe(19)
  })

  it('labels the game: result, score and clock, or tip time', () => {
    expect(gameLabel(game({}))).toBe('W 112–104')
    expect(gameLabel(game({ won: false, team_score: 99, opp_score: 101 }))).toBe('L 99–101')
    expect(gameLabel(game({ detail: 'Final/OT' }))).toBe('W 112–104 OT')
    expect(gameLabel(game({ status: 'live', detail: 'Q3 4:12', team_score: 78, opp_score: 71, won: null }))).toBe('78–71 · Q3 4:12')
    expect(gameLabel(game({ status: 'scheduled', team_score: null, opp_score: null, won: null }), { timeZone: 'Asia/Jerusalem' })).toBe('2:00 AM')
  })

  it('no spoilers: today reads as before live data', () => {
    const players = [player({ player_id: 1 })]
    expect(liveRosterMoment(day({ live: LIVE, players }), true)).toBeNull()
    expect(rosterDayNote(day({ live: LIVE, players }), new Date('2026-11-13T01:00:00Z'), true)).toMatch(/^Live · locked /)
  })
})
