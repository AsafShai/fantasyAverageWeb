const STRIP = /[^a-z0-9]/g

export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(STRIP, '')
}

const TEAM_CANON: Record<string, string> = {
  GS: 'GSW',
  GSW: 'GSW',
  NY: 'NYK',
  NYK: 'NYK',
  SA: 'SAS',
  SAS: 'SAS',
  NO: 'NOP',
  NOP: 'NOP',
  NOH: 'NOP',
  WSH: 'WAS',
  WAS: 'WAS',
  PHO: 'PHX',
  PHX: 'PHX',
  UTAH: 'UTA',
  UTA: 'UTA',
  BRO: 'BKN',
  BKN: 'BKN',
  NJN: 'BKN',
}

export function normalizeTeam(team: string): string {
  const raw = team.trim().toUpperCase().replace(/[^A-Z]/g, '')
  return TEAM_CANON[raw] || raw
}

export function parseEspnId(...values: Array<string | number | null | undefined>): number | null {
  for (const value of values) {
    if (value == null || value === '') continue
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
    const text = String(value).trim()
    if (/^\d+$/.test(text)) return Number(text)
  }
  return null
}
