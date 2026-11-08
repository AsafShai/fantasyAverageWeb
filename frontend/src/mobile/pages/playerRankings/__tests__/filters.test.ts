import { describe, expect, it } from 'vitest'
import {
  matchesFantasyTeam,
  parseFantasyTeamFilter,
  toggleFantasyTeamSelection,
} from '../filters'

describe('fantasy team filter', () => {
  it('parses legacy single team id into an array', () => {
    expect(parseFantasyTeamFilter(3)).toEqual([3])
  })

  it('matches multiple teams', () => {
    const filter = toggleFantasyTeamSelection(toggleFantasyTeamSelection(null, 2), 5)
    expect(filter).toEqual([2, 5])
    expect(matchesFantasyTeam(2, filter!)).toBe(true)
    expect(matchesFantasyTeam(5, filter!)).toBe(true)
    expect(matchesFantasyTeam(9, filter!)).toBe(false)
  })

  it('keeps exclusive presets', () => {
    expect(matchesFantasyTeam(0, 'rostered')).toBe(false)
    expect(matchesFantasyTeam(4, 0)).toBe(false)
    expect(matchesFantasyTeam(4, 'rostered')).toBe(true)
  })
})
