import { describe, expect, it } from 'vitest'
import type { SurpriseRow } from '../../../types/api'
import { applyFilters, filterOptions, filtersLabel, FREE_AGENTS, NO_FILTERS } from '../filters'

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

  it('the lineup works on its own, across every team, and leaves free agents out', () => {
    expect(ids(applyFilters(rows, { ...NO_FILTERS, lineup: 'started' }))).toEqual([1, 4])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, lineup: 'benched' }))).toEqual([2, 3])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, nbaTeam: 'DAL', lineup: 'started' }))).toEqual([])
    expect(ids(applyFilters(rows, { ...NO_FILTERS, nbaTeam: 'DAL', lineup: 'benched' }))).toEqual([2, 3])
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

describe('filterOptions with the league', () => {
  const league = [
    { team_id: 8, team_name: "Dor's Injured Team", abbrev: 'DIT' },
    { team_id: 4, team_name: 'DORELIT', abbrev: 'DOR' },
    { team_id: 11, team_name: 'Trust the process', abbrev: 'TTP' },
  ]

  it('lists every league team by name, also one with no row that night', () => {
    const options = filterOptions(rows.slice(0, 1), NO_FILTERS, league)
    expect(options.fantasyTeams).toEqual([
      { value: '8', label: "Dor's Injured Team" },
      { value: '4', label: 'DORELIT' },
      { value: '11', label: 'Trust the process' },
      { value: FREE_AGENTS, label: 'Free agents' },
    ])
  })

  it('a picked team with no rows keeps its name, not its code', () => {
    const options = filterOptions([], { fantasyTeam: '8', nbaTeam: '', lineup: 'all' }, league)
    expect(options.fantasyTeams.find((team) => team.value === '8')?.label).toBe("Dor's Injured Team")
  })
})

describe('the fantasy team is its id', () => {
  const league = [{ team_id: 11, team_name: 'Process Trusters', abbrev: 'PT' }]
  const night = [
    row({ player_id: 1, fantasy_team_id: 11, fantasy_team: 'TTP', fantasy_team_name: 'Trust the process' }),
    row({ player_id: 2, fantasy_team_id: 11, fantasy_team: 'PT', fantasy_team_name: 'Process Trusters' }),
    row({ player_id: 3, fantasy_team_id: 4, fantasy_team: 'DOR', fantasy_team_name: 'DORELIT' }),
  ]

  it('a team that changed its code and name is still one team', () => {
    const options = filterOptions(night, NO_FILTERS, league)
    expect(options.fantasyTeams.filter((team) => team.value === '11')).toEqual([{ value: '11', label: 'Process Trusters' }])
    expect(ids(applyFilters(night, { ...NO_FILTERS, fantasyTeam: '11' }, league))).toEqual([1, 2])
  })

  it('a row without an id is matched through its code', () => {
    const old = [row({ player_id: 9, fantasy_team: 'PT', fantasy_team_name: 'Process Trusters' })]
    expect(ids(applyFilters(old, { ...NO_FILTERS, fantasyTeam: '11' }, league))).toEqual([9])
    expect(filterOptions(old, NO_FILTERS, league).fantasyTeams.map((team) => team.value)).toEqual(['11', '__free_agents__'])
  })
})

describe('filtersLabel', () => {
  it('names what is filtered, and nothing when nothing is', () => {
    const { fantasyTeams } = filterOptions(rows, NO_FILTERS)
    expect(filtersLabel(NO_FILTERS, fantasyTeams)).toBeNull()
    expect(filtersLabel({ fantasyTeam: 'TTP', nbaTeam: 'BOS', lineup: 'started' }, fantasyTeams)).toBe('Trust the process · started · BOS')
    expect(filtersLabel({ fantasyTeam: FREE_AGENTS, nbaTeam: '', lineup: 'all' }, fantasyTeams)).toBe('Free agents')
    expect(filtersLabel({ ...NO_FILTERS, lineup: 'benched' }, fantasyTeams)).toBe('benched')
  })
})
