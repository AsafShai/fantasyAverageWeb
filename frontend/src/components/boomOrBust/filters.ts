import type { SurpriseRow, Team } from '../../types/api';

export type LineupFilter = 'all' | 'started' | 'benched';

/** The fantasy-team filter's value for players on no fantasy team that night. */
export const FREE_AGENTS = '__free_agents__';

export interface SurpriseFilters {
  /** Fantasy team id that night (as text), FREE_AGENTS, or '' for everyone. */
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

/** A row's fantasy team as the filter knows it: the team id. A row from a
 * server that does not send the id yet is matched through its code. */
function teamKey(row: SurpriseRow, idByCode: Map<string, string>): string | null {
  if (row.fantasy_team_id != null) return String(row.fantasy_team_id);
  if (row.fantasy_team == null) return null;
  return idByCode.get(row.fantasy_team) ?? row.fantasy_team;
}

function idsByCode(leagueTeams: Team[]): Map<string, string> {
  return new Map(leagueTeams.filter((team) => team.abbrev).map((team) => [team.abbrev as string, String(team.team_id)]));
}

/** Each row carries the teams of its own night, so a player who moved later
 * still counts for the teams he was on when he played. */
export function applyFilters(rows: SurpriseRow[], filters: SurpriseFilters, leagueTeams: Team[] = []): SurpriseRow[] {
  const lineup = lineupApplies(filters) ? filters.lineup : 'all';
  if (filters.fantasyTeam === '' && filters.nbaTeam === '') return rows;
  const idByCode = idsByCode(leagueTeams);
  return rows.filter((row) => {
    if (filters.nbaTeam !== '' && row.team_abbr !== filters.nbaTeam) return false;
    const team = teamKey(row, idByCode);
    if (filters.fantasyTeam === FREE_AGENTS) return team == null;
    if (filters.fantasyTeam !== '' && team !== filters.fantasyTeam) return false;
    if (lineup === 'started') return row.started === true;
    // Bench and IR alike: on the team, not in a spot that counted.
    if (lineup === 'benched') return row.started === false;
    return true;
  });
}

/** Every fantasy team in the league, by name, whether or not it has a row in
 * the period on screen: the list is the same on a quiet night and over the
 * season. NBA teams are the ones in the rows; a picked one stays in its list
 * when the period changes and it has no rows there. */
export function filterOptions(
  rows: SurpriseRow[],
  filters: SurpriseFilters,
  leagueTeams: Team[] = [],
): { fantasyTeams: FilterOption[]; nbaTeams: FilterOption[] } {
  const fantasy = new Map<string, string>();
  const nba = new Set<string>();
  let freeAgents = leagueTeams.length > 0;
  const idByCode = idsByCode(leagueTeams);
  for (const team of leagueTeams) fantasy.set(String(team.team_id), team.team_name);
  for (const row of rows) {
    if (row.team_abbr) nba.add(row.team_abbr);
    const team = teamKey(row, idByCode);
    if (team == null) freeAgents = true;
    else if (!fantasy.has(team)) fantasy.set(team, row.fantasy_team_name || row.fantasy_team || team);
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
