import { describe, expect, it } from 'vitest'
import {
  buildInjuryReportTeamKeys,
  buildInjuryStatusByPlayerName,
  isPlayerInjuryReportUnhealthy,
  isProTeamOnInjuryReport,
} from '../playerInjury'

describe('playerInjury (injuries page only)', () => {
  it('uses injury report Out, not ESPN injured flag', () => {
    const map = buildInjuryStatusByPlayerName([
      { game: '', team: 'SAC', player: 'Maxime Raynaud', status: 'Out', injury: '', last_update: '' },
    ])
    expect(isPlayerInjuryReportUnhealthy({ player_name: 'Maxime Raynaud' }, map)).toBe(true)
    expect(isPlayerInjuryReportUnhealthy({ player_name: 'Nobody' }, map)).toBe(false)
  })

  it('matches pro_team abbr to full team name on the injury report', () => {
    const keys = buildInjuryReportTeamKeys([
      { game: '', team: 'Los Angeles Lakers', player: 'A', status: 'Out', injury: '', last_update: '' },
    ])
    expect(isProTeamOnInjuryReport('LAL', keys, [{ abbreviation: 'LAL', team_name: 'Los Angeles Lakers' }])).toBe(true)
    expect(isProTeamOnInjuryReport('SAC', keys, [{ abbreviation: 'SAC', team_name: 'Sacramento Kings' }])).toBe(false)
  })

  it('does not treat Available on the report as unhealthy', () => {
    const map = buildInjuryStatusByPlayerName([
      { game: '', team: 'LAL', player: 'LeBron James', status: 'Available', injury: '', last_update: '' },
    ])
    expect(isPlayerInjuryReportUnhealthy({ player_name: 'LeBron James' }, map)).toBe(false)
  })
})
