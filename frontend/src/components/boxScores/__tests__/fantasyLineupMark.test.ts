import { describe, expect, it } from 'vitest'
import { fantasyLineupState, resolveFantasyContext } from '../fantasyLineupMark'
import type { FantasyNightContext, SlatePlayerValue } from '../../../types/boxScore'

describe('fantasyLineupState', () => {
  it('maps started, bench, and IR', () => {
    expect(fantasyLineupState({ fantasy_team: 'X', started: true })).toBe('started')
    expect(fantasyLineupState({ fantasy_team: 'X', started: false, lineup_slot: 'BE' })).toBe('bench')
    expect(fantasyLineupState({ fantasy_team: 'X', started: false, lineup_slot: 'IR' })).toBe('ir')
    expect(fantasyLineupState({ fantasy_team: 'X', started: null })).toBeNull()
    expect(fantasyLineupState(null)).toBeNull()
  })
})

describe('resolveFantasyContext', () => {
  const values = new Map<string, SlatePlayerValue>([
    ['1', {
      player_id: '1', name: 'A', position: 'G', team_abbr: 'LAL', team_logo: '', opponent_abbr: 'BOS',
      is_home: true, game_id: 'g', game_status: 'final', min: '', pts: '', reb: '', ast: '', stl: '', blk: '',
      tov: '', fg: '', fg3: '', ft: '', stats: {}, z: 0,
      fantasy_team: 'TTP', fantasy_team_name: 'Trust', lineup_slot: 'PG', started: true,
    }],
  ])
  const fantasyPlayers: Record<string, FantasyNightContext> = {
    '2': { fantasy_team: 'LA', started: false, lineup_slot: 'BE' },
  }

  it('prefers the slate line over fantasy_players', () => {
    expect(resolveFantasyContext('1', values, fantasyPlayers)?.lineup_slot).toBe('PG')
  })

  it('falls back to fantasy_players before tip', () => {
    expect(resolveFantasyContext('2', values, fantasyPlayers)?.started).toBe(false)
  })
})
