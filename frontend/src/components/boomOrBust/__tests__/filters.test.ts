import { describe, expect, it } from 'vitest'
import type { SurpriseRow } from '../../../types/api'
import { applyFilters, filterOptions, filtersLabel, FREE_AGENTS, lineupApplies, NO_FILTERS } from '../filters'

const row = (over: Partial<SurpriseRow>): SurpriseRow => ({
  game_date: '2026-11-24', player_id: 1, player_name: 'Player', team_abbr: 'BOS', opponent_abbr: 'LAL', is_home: true,
  minutes: 30, pts: 20, reb: 5, ast: 4, fg3m: 2, stl: 1, blk: 0, fgm: 8, fga: 15, ftm: 2, fta: 2,
  score: 2.4, metric_z: 2, metric_err: 1, has_estimate: true,
  fantasy_team: 'TTP', fantasy_team_name: 'Trust the process', lineup_slot: 'SF', started: true,
  reasons: [], verdict: 'good',
  ...over,
})

const rows = [
  row({ player_id: 1, team_abbr: 'BOS', fantasy_team: 'TTP', started: true }),
  row({ player_id: 2, team_abbr: 'DAL', fantasy_team: 'TTP', started: false, lineup_slot: 'BE' }),
  row({ player_id: 3, team_abbr: 'DAL', fantasy_team: 'TTP', started: false, lineup_slot: 'IR' }),
  row({ player_id: 4, team_abbr: 'BOS', fantasy_team: 'DOR', fantasy_team_name: 'DORELIT', started: true }),
  row({ player_id: 5, team_abbr: 'DET', fantasy_team: null, fantasy_team_name: null, lineup_slot: null, started: null }),
]
const ids = (out: SurpriseRow[]) => out.map((r) => r.player_id)

describe('applyFilters', () => {
  it('keeps every row with no filter on', () => {
    expect(applyFilters(rows, NO_FILTERS)).toBe(rows)
  })

  it('filters by the fantasy team and the NBA team of that night', () => {
    expect(ids(applyFilters(rows, { ...NO_FILTERS, fantasyTeam: 'TTP' }))).toEqual([1, 2, 3])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, nbaTeam: 'BOS' }))).toEqual([1, 4])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, fantasyTeam: 'TTP', nbaTeam: 'DAL' }))).toEqual([2, 3])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, fantasyTeam: FREE_AGENTS }))).toEqual([5])
  })

  it('splits a fantasy team into started and benched, IR with the bench', () => {
    expect(ids(applyFilters(rows, { ...NO_FILTERS, fantasyTeam: 'TTP', lineup: 'started' }))).toEqual([1])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, fantasyTeam: 'TTP', lineup: 'benched' }))).toEqual([2, 3])
  })

  it('ignores the lineup choice without one fantasy team picked', () => {
    expect(lineupApplies({ ...NO_FILTERS, lineup: 'started' })).toBe(false)
    expect(ids(applyFilters(rows, { ...NO_FILTERS, nbaTeam: 'DAL', lineup: 'started' }))).toEqual([2, 3])
    expect(ids(applyFilters(rows, { fantasyTeam: FREE_AGENTS, nbaTeam: '', lineup: 'started' }))).toEqual([5])
  })
})

describe('filterOptions', () => {
  it('lists the teams in the rows by name, free agents last', () => {
    const options = filterOptions(rows, NO_FILTERS)
    expect(options.fantasyTeams).toEqual([
      { value: 'DOR', label: 'DORELIT' },
      { value: 'TTP', label: 'Trust the process' },
      { value: FREE_AGENTS, label: 'Free agents' },
    ])
    expect(options.nbaTeams.map((team) => team.value)).toEqual(['BOS', 'DAL', 'DET'])
  })

  it('keeps a picked team that has no rows in this period', () => {
    const options = filterOptions(rows.slice(0, 1), { fantasyTeam: 'ASA', nbaTeam: 'MIA', lineup: 'all' })
    expect(options.fantasyTeams.map((team) => team.value)).toEqual(['ASA', 'TTP'])
    expect(options.nbaTeams.map((team) => team.value)).toEqual(['BOS', 'MIA'])
  })
})

describe('filtersLabel', () => {
  it('names what is filtered, and nothing when nothing is', () => {
    const { fantasyTeams } = filterOptions(rows, NO_FILTERS)
    expect(filtersLabel(NO_FILTERS, fantasyTeams)).toBeNull()
    expect(filtersLabel({ fantasyTeam: 'TTP', nbaTeam: 'BOS', lineup: 'started' }, fantasyTeams)).toBe('Trust the process · started · BOS')
    expect(filtersLabel({ fantasyTeam: FREE_AGENTS, nbaTeam: '', lineup: 'benched' }, fantasyTeams)).toBe('Free agents')
  })
})
