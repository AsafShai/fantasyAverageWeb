/** NBA clubs as the rankings table stores them (ESPN pro-team codes, including PHL and PHO). */
export interface NbaTeam {
  abbr: string
  name: string
  /** Other words people type that are not already in the name, such as "sixers" or "phx". */
  aliases: string
}

export const NBA_TEAMS: NbaTeam[] = [
  { abbr: 'ATL', name: 'Atlanta Hawks', aliases: '' },
  { abbr: 'BOS', name: 'Boston Celtics', aliases: '' },
  { abbr: 'BKN', name: 'Brooklyn Nets', aliases: 'brk' },
  { abbr: 'CHA', name: 'Charlotte Hornets', aliases: '' },
  { abbr: 'CHI', name: 'Chicago Bulls', aliases: '' },
  { abbr: 'CLE', name: 'Cleveland Cavaliers', aliases: 'cavs' },
  { abbr: 'DAL', name: 'Dallas Mavericks', aliases: 'mavs' },
  { abbr: 'DEN', name: 'Denver Nuggets', aliases: '' },
  { abbr: 'DET', name: 'Detroit Pistons', aliases: '' },
  { abbr: 'GSW', name: 'Golden State Warriors', aliases: 'gs dubs' },
  { abbr: 'HOU', name: 'Houston Rockets', aliases: '' },
  { abbr: 'IND', name: 'Indiana Pacers', aliases: '' },
  { abbr: 'LAC', name: 'LA Clippers', aliases: 'los angeles clippers' },
  { abbr: 'LAL', name: 'Los Angeles Lakers', aliases: '' },
  { abbr: 'MEM', name: 'Memphis Grizzlies', aliases: 'grizz' },
  { abbr: 'MIA', name: 'Miami Heat', aliases: '' },
  { abbr: 'MIL', name: 'Milwaukee Bucks', aliases: '' },
  { abbr: 'MIN', name: 'Minnesota Timberwolves', aliases: 'wolves' },
  { abbr: 'NOP', name: 'New Orleans Pelicans', aliases: 'no pels' },
  { abbr: 'NYK', name: 'New York Knicks', aliases: 'ny' },
  { abbr: 'OKC', name: 'Oklahoma City Thunder', aliases: '' },
  { abbr: 'ORL', name: 'Orlando Magic', aliases: '' },
  { abbr: 'PHL', name: 'Philadelphia 76ers', aliases: 'phi sixers philly' },
  { abbr: 'PHO', name: 'Phoenix Suns', aliases: 'phx' },
  { abbr: 'POR', name: 'Portland Trail Blazers', aliases: 'blazers' },
  { abbr: 'SAC', name: 'Sacramento Kings', aliases: '' },
  { abbr: 'SAS', name: 'San Antonio Spurs', aliases: 'sa' },
  { abbr: 'TOR', name: 'Toronto Raptors', aliases: '' },
  { abbr: 'UTA', name: 'Utah Jazz', aliases: '' },
  { abbr: 'WAS', name: 'Washington Wizards', aliases: 'wsh' },
].sort((a, b) => a.name.localeCompare(b.name))

const KNOWN = new Set(NBA_TEAMS.map((team) => team.abbr))

export function filterNbaTeams(query: string): NbaTeam[] {
  const q = query.trim().toLowerCase()
  if (!q) return NBA_TEAMS
  return NBA_TEAMS.filter((team) =>
    team.abbr.toLowerCase().includes(q) ||
    team.name.toLowerCase().includes(q) ||
    team.aliases.toLowerCase().includes(q),
  )
}

/** Empty means every team. A player stays when his pro team is one of the picks. */
export function matchesNbaTeam(proTeam: string, selected: readonly string[]): boolean {
  if (selected.length === 0) return true
  return selected.includes(proTeam)
}

export function toggleNbaTeam(selected: readonly string[], abbr: string): string[] {
  return selected.includes(abbr) ? selected.filter((team) => team !== abbr) : [...selected, abbr]
}

/** Drop anything that is not a current NBA code, so an old saved filter cannot stick. */
export function parseNbaTeams(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((value): value is string => typeof value === 'string' && KNOWN.has(value))
}
