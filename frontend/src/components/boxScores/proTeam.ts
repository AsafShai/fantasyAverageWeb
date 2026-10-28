/** Site scoreboards use a shorter abbreviation than the fantasy roster. */
const SITE_TO_FANTASY: Record<string, string> = {
  NO: 'NOP',
  GS: 'GSW',
  NY: 'NYK',
  PHI: 'PHL',
  PHX: 'PHO',
  SA: 'SAS',
  UTAH: 'UTA',
  WSH: 'WAS',
}

/** ESPN team id for a site-scoreboard abbreviation. */
const SITE_TEAM_ID: Record<string, string> = {
  ATL: '1',
  BOS: '2',
  NO: '3',
  CHI: '4',
  CLE: '5',
  DAL: '6',
  DEN: '7',
  DET: '8',
  GS: '9',
  HOU: '10',
  IND: '11',
  LAC: '12',
  LAL: '13',
  MIA: '14',
  MIL: '15',
  MIN: '16',
  BKN: '17',
  NY: '18',
  ORL: '19',
  PHI: '20',
  PHX: '21',
  POR: '22',
  SAC: '23',
  SA: '24',
  OKC: '25',
  UTAH: '26',
  WSH: '27',
  TOR: '28',
  MEM: '29',
  CHA: '30',
}

export function fantasyProTeam(siteAbbr: string): string {
  return SITE_TO_FANTASY[siteAbbr] ?? siteAbbr
}

export function nbaTeamId(siteAbbr: string): string {
  return SITE_TEAM_ID[siteAbbr] ?? ''
}
