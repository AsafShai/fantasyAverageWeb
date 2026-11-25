import type { SurpriseRow, Team } from '../../types/api';
import { fantasyTeamOptionLabel } from '../../myTeam/display';

export type LineupFilter = 'all' | 'started' | 'benched';

/** The fantasy-team filter's value for players on no fantasy team that night. */
export const FREE_AGENTS = '__free_agents__';

export interface SurpriseFilters {
  /** Fantasy team id that night (as text), FREE_AGENTS, or '' for everyone. */
  fantasyTeam: string;
  /** NBA team that night, or '' for every team. */
  nbaTeam: string;
  /** Started or benched leaves free agents out: they have no lineup spot. */
  lineup: LineupFilter;
}

export const NO_FILTERS: SurpriseFilters = { fantasyTeam: '', nbaTeam: '', lineup: 'all' };

export interface FilterOption {
  value: string;
  label: string;
}

/** One fantasy team is picked, not everyone and not the free agents. */
function teamPicked(filters: SurpriseFilters): boolean {
  return filters.fantasyTeam !== '' && filters.fantasyTeam !== FREE_AGENTS;
}

export function anyFilter(filters: SurpriseFilters): boolean {
  return filters.fantasyTeam !== '' || filters.nbaTeam !== '' || filters.lineup !== 'all';
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
  const { lineup } = filters;
  if (!anyFilter(filters)) return rows;
  const idByCode = idsByCode(leagueTeams);
  return rows.filter((row) => {
    if (filters.nbaTeam !== '' && row.team_abbr !== filters.nbaTeam) return false;
    const team = teamKey(row, idByCode);
    if (filters.fantasyTeam === FREE_AGENTS) {
      if (team != null) return false;
    } else if (filters.fantasyTeam !== '' && team !== filters.fantasyTeam) return false;
    if (lineup === 'started') return row.started === true;
    // Bench and IR alike: on the team, not in a spot that counted.
    if (lineup === 'benched') return row.started === false;
    return true;
  });
}

export interface FilterContext {
  leagueTeams?: Team[];
  /** The viewer's own fantasy team leads the list. */
  myTeamId?: number | null;
  /** The rows past the score bars: the booms and busts on screen before any
   * team filter. Without them every row counts. */
  pastBars?: SurpriseRow[];
}

/** Every fantasy team in the league, by name, the viewer's own first, whether
 * or not it has a row in the period on screen: the list is the same on a
 * quiet night and over the season. NBA teams are only the ones with a boom or
 * a bust to show for the fantasy team and lineup picked, so nobody scrolls
 * past thirty teams to find the few that have something; a picked one stays
 * in its list when it no longer has any. */
export function filterOptions(
  rows: SurpriseRow[],
  filters: SurpriseFilters,
  { leagueTeams = [], myTeamId = null, pastBars }: FilterContext = {},
): { fantasyTeams: FilterOption[]; nbaTeams: FilterOption[] } {
  const fantasy = new Map<string, string>();
  const nba = new Set<string>();
  let freeAgents = leagueTeams.length > 0;
  const idByCode = idsByCode(leagueTeams);
  for (const team of leagueTeams) fantasy.set(String(team.team_id), team.team_name);
  for (const row of applyFilters(pastBars ?? rows, { ...filters, nbaTeam: '' }, leagueTeams)) {
    if (row.team_abbr) nba.add(row.team_abbr);
  }
  for (const row of rows) {
    const team = teamKey(row, idByCode);
    if (team == null) freeAgents = true;
    else if (!fantasy.has(team)) fantasy.set(team, row.fantasy_team_name || row.fantasy_team || team);
  }
  if (teamPicked(filters) && !fantasy.has(filters.fantasyTeam)) fantasy.set(filters.fantasyTeam, filters.fantasyTeam);
  if (filters.nbaTeam !== '') nba.add(filters.nbaTeam);
  const mine = myTeamId == null ? null : String(myTeamId);
  const fantasyTeams = [...fantasy.entries()]
    .map(([value, label]) => ({ value, label: fantasyTeamOptionLabel(label, value === mine) }))
    .sort((a, b) => Number(b.value === mine) - Number(a.value === mine) || a.label.localeCompare(b.label));
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
  }
  if (filters.lineup !== 'all') parts.push(filters.lineup);
  if (filters.nbaTeam !== '') parts.push(filters.nbaTeam);
  return parts.length ? parts.join(' · ') : null;
}
