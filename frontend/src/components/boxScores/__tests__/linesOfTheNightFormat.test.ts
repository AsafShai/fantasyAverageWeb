import { describe, expect, it } from 'vitest'
import { lineSummary, signedZ } from '../linesOfTheNightFormat'
import type { SlatePlayerValue } from '../../../types/boxScore'

const luka: SlatePlayerValue = {
  player_id: '3945274', name: 'Luka Doncic', position: 'G', team_abbr: 'LAL', team_logo: '',
  opponent_abbr: 'UTAH', is_home: false, game_id: '1', game_status: 'final',
  min: '38', pts: '52', reb: '8', ast: '10', stl: '2', blk: '0', tov: '4',
  fg: '17-30', fg3: '8-18', ft: '10-11', z: 2.4, fantasy_team: 'LA', fantasy_team_name: 'Lakers Fans', stats: {},
}

describe('lines of the night format', () => {
  it('signs and rounds the z', () => {
    expect(signedZ(2.4)).toBe('+2.40')
    expect(signedZ(-0.5)).toBe('-0.50')
  })

  it('summarises the line, leaving out empty extras', () => {
    expect(lineSummary(luka)).toBe('52 PTS · 8 REB · 10 AST · 2 STL · 8 3PM')
  })
})
