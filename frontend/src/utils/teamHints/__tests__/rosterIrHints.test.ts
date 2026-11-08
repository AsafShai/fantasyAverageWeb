import { describe, expect, it } from 'vitest'
import type { Player } from '../../../types/api'
import { normalizePlayerName } from '../../../utils/playerName'
import { detectRosterHints } from '../detectors/roster'
import type { RankLookups } from '../types'
import { minimalTeamDetail } from './fixtures'

const ranks: RankLookups = {
  season: new Map(),
  last15: new Map(),
  poolSizeSeason: 100,
  poolSizeLast15: 100,
}

function player(id: number, name: string, slot: string): Player {
  return {
    player_id: id,
    player_name: name,
    pro_team: 'LAL',
    positions: ['PG'],
    lineup_slot: slot,
    stats: { gp: 10, minutes: 200, pts: 10, reb: 2, ast: 5, stl: 0, blk: 0, fgm: 1, fga: 2, ftm: 1, fta: 1, fg_percentage: 0.5, ft_percentage: 0.5, three_pm: 0 },
    team_id: 1,
    status: 'ONTEAM',
    has_data: true,
  }
}

describe('detectRosterHints (IR)', () => {
  it('suggests clearing IR when occupant is not Out and their NBA team is on the report', () => {
    const hints = detectRosterHints({
      teamDetail: minimalTeamDetail([player(1, 'Returner', 'IR')]),
      ranks,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Returner'), 'Probable']]),
      injuryReportTeamKeys: new Set(['losangeleslakers']),
      nbaTeams: [{ abbreviation: 'LAL', team_name: 'Los Angeles Lakers' }],
    })
    expect(hints.some((h) => h.id === 'roster-ir-not-out')).toBe(true)
    expect(hints.some((h) => h.id === 'roster-ir-fill-empty')).toBe(false)
  })

  it('does not suggest review IR when the player NBA team is missing from the injury report', () => {
    const hints = detectRosterHints({
      teamDetail: minimalTeamDetail([player(1, 'Returner', 'IR')]),
      ranks,
      injuryStatusByPlayerName: new Map(),
      injuryReportTeamKeys: new Set(['sacramentokings']),
      nbaTeams: [{ abbreviation: 'LAL', team_name: 'Los Angeles Lakers' }],
    })
    expect(hints.some((h) => h.id === 'roster-ir-not-out')).toBe(false)
  })

  it('does not flag IR occupant who is still Out', () => {
    const hints = detectRosterHints({
      teamDetail: minimalTeamDetail([player(1, 'Hurt', 'IR')]),
      ranks,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Hurt'), 'Out']]),
    })
    expect(hints.some((h) => h.id === 'roster-ir-not-out')).toBe(false)
  })

  it('suggests moving Out player to IR when slot is empty', () => {
    const hints = detectRosterHints({
      teamDetail: minimalTeamDetail([player(1, 'Hurt', 'BE')]),
      ranks,
      injuryStatusByPlayerName: new Map([[normalizePlayerName('Hurt'), 'Out']]),
    })
    expect(hints.some((h) => h.id === 'roster-ir-fill-empty')).toBe(true)
    const fill = hints.find((h) => h.id === 'roster-ir-fill-empty')!
    expect(fill.players![0].name).toBe('Hurt')
    expect(fill.players![0].injuryStatus).toBe('Out')
  })
})
