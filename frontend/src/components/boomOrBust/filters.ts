import type { SurpriseRow } from '../../types/api';

export type LineupFilter = 'all' | 'started' | 'benched';

/** The fantasy-team filter's value for players on no fantasy team that night. */
export const FREE_AGENTS = '__free_agents__';

export interface SurpriseFilters {
  /** Fantasy team code that night, FREE_AGENTS, or '' for everyone. */
  fantasyTeam: string;
  /** NBA team that night, or '' for every team. */
  nbaTeam: string;
  /** Counts only while one fantasy team is picked. */
  lineup: LineupFilter;
}

export const NO_FILTERS: SurpriseFilters = { fantasyTeam: '', nbaTeam: '', lineup: 'all' };

export interface FilterOption {
  value: string;
  label: string;
}

/** A lineup spot exists only on a fantasy team. */
export function lineupApplies(filters: SurpriseFilters): boolean {
  return filters.fantasyTeam !== '' && filters.fantasyTeam !== FREE_AGENTS;
}

/** Each row carries the teams of its own night, so a player who moved later
 * still counts for the teams he was on when he played. */
export function applyFilters(rows: SurpriseRow[], filters: SurpriseFilters): SurpriseRow[] {
  const lineup = lineupApplies(filters) ? filters.lineup : 'all';
  if (filters.fantasyTeam === '' && filters.nbaTeam === '') return rows;
  return rows.filter((row) => {
    if (filters.nbaTeam !== '' && row.team_abbr !== filters.nbaTeam) return false;
    if (filters.fantasyTeam === FREE_AGENTS) return row.fantasy_team == null;
    if (filters.fantasyTeam !== '' && row.fantasy_team !== filters.fantasyTeam) return false;
    if (lineup === 'started') return row.started === true;
    // Bench and IR alike: on the team, not in a spot that counted.
    if (lineup === 'benched') return row.started === false;
    return true;
  });
}

/** The teams in the rows on screen, by name. A picked team stays in its list
 * when the period changes and it has no rows there. */
export function filterOptions(
  rows: SurpriseRow[],
  filters: SurpriseFilters,
): { fantasyTeams: FilterOption[]; nbaTeams: FilterOption[] } {
  const fantasy = new Map<string, string>();
  const nba = new Set<string>();
  let freeAgents = false;
  for (const row of rows) {
    if (row.team_abbr) nba.add(row.team_abbr);
    if (row.fantasy_team == null) freeAgents = true;
    else if (!fantasy.has(row.fantasy_team)) fantasy.set(row.fantasy_team, row.fantasy_team_name || row.fantasy_team);
  }
  if (lineupApplies(filters) && !fantasy.has(filters.fantasyTeam)) fantasy.set(filters.fantasyTeam, filters.fantasyTeam);
  if (filters.nbaTeam !== '') nba.add(filters.nbaTeam);
  const fantasyTeams = [...fantasy.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (freeAgents || filters.fantasyTeam === FREE_AGENTS) fantasyTeams.push({ value: FREE_AGENTS, label: 'Free agents' });
  return {
    fantasyTeams,
    nbaTeams: [...nba].sort().map((value) => ({ value, label: value })),
  };
}

/** "Trust the process · started · BOS" for the share card; null with no filter on. */
export function filtersLabel(filters: SurpriseFilters, fantasyTeams: FilterOption[]): string | null {
  const parts: string[] = [];
  if (filters.fantasyTeam !== '') {
    parts.push(fantasyTeams.find((team) => team.value === filters.fantasyTeam)?.label ?? filters.fantasyTeam);
    if (lineupApplies(filters) && filters.lineup !== 'all') parts.push(filters.lineup);
  }
  if (filters.nbaTeam !== '') parts.push(filters.nbaTeam);
  return parts.length ? parts.join(' · ') : null;
}
