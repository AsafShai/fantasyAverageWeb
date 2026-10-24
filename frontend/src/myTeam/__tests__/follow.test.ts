import { describe, expect, it } from 'vitest'
import { resolveFollow, USER_PICK } from '../follow'
import { normalizePlayerName } from '../../utils/playerName'
import { leadWithMyTeam } from '../display'

describe('resolveFollow', () => {
  it('fills an empty control once My Team is known', () => {
    expect(resolveFollow(null, 4, undefined)).toEqual({ applied: 4, next: 4 })
  })

  it('leaves a manual pick alone', () => {
    expect(resolveFollow(2, 4, undefined)).toEqual({ applied: USER_PICK, next: null })
  })

  it('does not refill a control the user cleared after choosing another team', () => {
    expect(resolveFollow(null, 4, USER_PICK)).toEqual({ applied: USER_PICK, next: null })
  })

  it('moves a control that is still on the previous automatic team', () => {
    expect(resolveFollow(4, 7, 4)).toEqual({ applied: 7, next: 7 })
  })

  it('does not refill after the control is cleared', () => {
    expect(resolveFollow(null, 4, 4)).toEqual({ applied: 4, next: null })
  })

  it('does nothing until a team is chosen', () => {
    expect(resolveFollow(null, null, undefined)).toEqual({ applied: undefined, next: null })
  })
})

describe('normalizePlayerName', () => {
  it('matches an injury-report name to a roster name', () => {
    expect(normalizePlayerName('P.J. Washington Jr.')).toBe(normalizePlayerName('PJ Washington'))
  })
})

describe('leadWithMyTeam', () => {
  it('puts the chosen team first and keeps everyone else', () => {
    const teams = [
      { team_id: 1, team_name: 'A' },
      { team_id: 2, team_name: 'B' },
      { team_id: 3, team_name: 'C' },
    ]
    expect(leadWithMyTeam(teams, 3).map(team => team.team_id)).toEqual([3, 1, 2])
  })
})
