import { describe, expect, it } from 'vitest'
import { fantasyProTeam, nbaTeamId } from '../proTeam'

describe('fantasyProTeam', () => {
  it('turns a site abbreviation into the fantasy roster abbreviation', () => {
    expect(fantasyProTeam('UTAH')).toBe('UTA')
    expect(fantasyProTeam('NY')).toBe('NYK')
    expect(fantasyProTeam('LAL')).toBe('LAL')
  })
})

describe('nbaTeamId', () => {
  it('resolves a site abbreviation to the ESPN team id', () => {
    expect(nbaTeamId('NY')).toBe('18')
    expect(nbaTeamId('CHI')).toBe('4')
    expect(nbaTeamId('UTAH')).toBe('26')
    expect(nbaTeamId('LAL')).toBe('13')
  })
})