import { describe, expect, it } from 'vitest'
import { filterNbaTeams, matchesNbaTeam, parseNbaTeams, toggleNbaTeam } from '../nbaTeams'

describe('NBA team filter', () => {
  it('lists all 30 teams until you type', () => {
    expect(filterNbaTeams('')).toHaveLength(30)
    expect(filterNbaTeams('   ')).toHaveLength(30)
  })

  it('matches a name, an abbreviation, or a nickname', () => {
    expect(filterNbaTeams('lakers').map((team) => team.abbr)).toEqual(['LAL'])
    expect(filterNbaTeams('bos').map((team) => team.abbr)).toEqual(['BOS'])
    expect(filterNbaTeams('sixers').map((team) => team.abbr)).toEqual(['PHL'])
    expect(filterNbaTeams('phx').map((team) => team.abbr)).toEqual(['PHO'])
  })

  it('keeps every player until a team is picked, then only those teams', () => {
    expect(matchesNbaTeam('LAL', [])).toBe(true)
    expect(matchesNbaTeam('BOS', ['LAL'])).toBe(false)
    expect(matchesNbaTeam('BOS', ['LAL', 'BOS'])).toBe(true)
    expect(toggleNbaTeam(['LAL'], 'BOS')).toEqual(['LAL', 'BOS'])
    expect(toggleNbaTeam(['LAL', 'BOS'], 'LAL')).toEqual(['BOS'])
  })

  it('drops a saved code that is not an NBA team', () => {
    expect(parseNbaTeams(['LAL', 'NOPE', 3])).toEqual(['LAL'])
    expect(parseNbaTeams('LAL')).toEqual([])
  })
})
