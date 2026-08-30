import type { AdpIndexPlayer, AdpMetric, AdpPlayer, LastYearStats, ProviderMeta } from '../types/api'

export const ADP_SITES = ['espn', 'fantrax', 'sleeper', 'yahoo'] as const
export type AdpSiteKey = (typeof ADP_SITES)[number]

export const SITE_LABEL: Record<AdpSiteKey, string> = {
  espn: 'ESPN',
  fantrax: 'Fantrax',
  sleeper: 'Sleeper',
  yahoo: 'Yahoo',
}

/** Only used until the server's own capability matrix arrives with the first response. */
const FALLBACK_CAPABILITIES: Record<AdpSiteKey, { adp: boolean; rankings: boolean }> = {
  espn: { adp: true, rankings: true },
  fantrax: { adp: true, rankings: false },
  sleeper: { adp: false, rankings: true },
  yahoo: { adp: true, rankings: true },
}

export function isAdpSite(key: string): key is AdpSiteKey {
  return (ADP_SITES as readonly string[]).includes(key)
}

/** Sites that carry data for `metric`, in a stable order. Server-owned when available. */
export function sitesForMetric(metric: AdpMetric, providers?: ProviderMeta[]): AdpSiteKey[] {
  const capable = new Set<AdpSiteKey>()
  if (providers?.length) {
    for (const provider of providers) {
      if (!isAdpSite(provider.key)) continue
      if (metric === 'adp' ? provider.has_adp : provider.has_rankings) capable.add(provider.key)
    }
  } else {
    for (const site of ADP_SITES) {
      if (metric === 'adp' ? FALLBACK_CAPABILITIES[site].adp : FALLBACK_CAPABILITIES[site].rankings) {
        capable.add(site)
      }
    }
  }
  return ADP_SITES.filter((site) => capable.has(site))
}

export function siteValue(player: AdpPlayer, site: AdpSiteKey, metric: AdpMetric): number | null {
  return metric === 'adp' ? player[site].adp : player[site].ranking
}

export function blendValue(player: AdpPlayer, metric: AdpMetric): number | null {
  return metric === 'adp' ? player.blend : player.ranking_blend
}

export function blendRankValue(
  player: AdpPlayer | AdpIndexPlayer,
  metric: AdpMetric,
): number | null {
  return metric === 'adp' ? player.blend_rank : player.ranking_blend_rank
}

export function spreadValue(player: AdpPlayer, metric: AdpMetric): number | null {
  return metric === 'adp' ? player.spread : player.ranking_spread
}

export const METRIC_LABEL: Record<AdpMetric, string> = { adp: 'ADP', rank: 'Rankings' }
export const BLEND_LABEL: Record<AdpMetric, string> = { adp: 'Blend ADP', rank: 'Blend Rank' }
/** Draft pages open on rankings blend, not ADP. */
export const DEFAULT_DRAFT_METRIC: AdpMetric = 'rank'

export function formatAdp(value: number | null | undefined): string {
  if (value == null) return '—'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatLastYearStat(value: number | null | undefined, pct = false, whole = false): string {
  if (value == null) return '—'
  if (pct) return (value * 100).toFixed(1)
  if (whole) return String(Math.round(value))
  return value.toFixed(1)
}

export type StatCol = { key: keyof LastYearStats; label: string; pct?: boolean; whole?: boolean }

/** Per-game line shown on the draft pages, games played first for context. */
export const LAST_YEAR_COLS: StatCol[] = [
  { key: 'gp', label: 'GP', whole: true },
  { key: 'fg_pct', label: 'FG%', pct: true },
  { key: 'ft_pct', label: 'FT%', pct: true },
  { key: 'ppg', label: 'PPG' },
  { key: 'rpg', label: 'RPG' },
  { key: 'apg', label: 'APG' },
  { key: 'spg', label: 'SPG' },
  { key: 'bpg', label: 'BPG' },
  { key: 'three_pm', label: '3PM' },
]

export function adpDeltaClass(adp: number | null | undefined, blend: number | null | undefined): string {
  if (adp == null || blend == null) return 'text-gray-400'
  const d = adp - blend
  if (d <= -4) return 'text-emerald-600 dark:text-emerald-400 font-semibold'
  if (d <= -1.5) return 'text-emerald-700 dark:text-emerald-300'
  if (d >= 4) return 'text-rose-600 dark:text-rose-400 font-semibold'
  if (d >= 1.5) return 'text-rose-700 dark:text-rose-300'
  return ''
}

export function formatUpdatedAt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function isThreeRrReverse(roundIndex: number): boolean {
  if (roundIndex <= 0) return false
  if (roundIndex === 1) return true
  return roundIndex % 2 === 0
}

export function isReverseRound(roundIndex: number, threeRr = true): boolean {
  return threeRr ? isThreeRrReverse(roundIndex) : roundIndex % 2 === 1
}

export const DRAFT_TEAM_COLORS = [
  'bg-red-100 dark:bg-red-950/70 border-red-300 dark:border-red-800',
  'bg-orange-100 dark:bg-orange-950/70 border-orange-300 dark:border-orange-800',
  'bg-amber-100 dark:bg-amber-950/70 border-amber-300 dark:border-amber-800',
  'bg-yellow-100 dark:bg-yellow-950/70 border-yellow-300 dark:border-yellow-800',
  'bg-lime-100 dark:bg-lime-950/70 border-lime-300 dark:border-lime-800',
  'bg-green-100 dark:bg-green-950/70 border-green-300 dark:border-green-800',
  'bg-emerald-100 dark:bg-emerald-950/70 border-emerald-300 dark:border-emerald-800',
  'bg-teal-100 dark:bg-teal-950/70 border-teal-300 dark:border-teal-800',
  'bg-cyan-100 dark:bg-cyan-950/70 border-cyan-300 dark:border-cyan-800',
  'bg-sky-100 dark:bg-sky-950/70 border-sky-300 dark:border-sky-800',
  'bg-blue-100 dark:bg-blue-950/70 border-blue-300 dark:border-blue-800',
  'bg-indigo-100 dark:bg-indigo-950/70 border-indigo-300 dark:border-indigo-800',
  'bg-violet-100 dark:bg-violet-950/70 border-violet-300 dark:border-violet-800',
  'bg-purple-100 dark:bg-purple-950/70 border-purple-300 dark:border-purple-800',
  'bg-fuchsia-100 dark:bg-fuchsia-950/70 border-fuchsia-300 dark:border-fuchsia-800',
  'bg-pink-100 dark:bg-pink-950/70 border-pink-300 dark:border-pink-800',
] as const

export function draftTeamColor(teamSlot: number): string {
  const i = ((teamSlot % DRAFT_TEAM_COLORS.length) + DRAFT_TEAM_COLORS.length) % DRAFT_TEAM_COLORS.length
  return DRAFT_TEAM_COLORS[i]
}

export function draftTeamForPick(pick: number, teams: number, threeRr = true): number {
  if (teams <= 0 || pick <= 0) return 1
  const r = Math.floor((pick - 1) / teams)
  const pos = (pick - 1) % teams
  return isReverseRound(r, threeRr) ? teams - pos : pos + 1
}

export const DRAFT_TEAMS = 13
export const DRAFT_ROUNDS = 14
export const DRAFT_PICKS = DRAFT_TEAMS * DRAFT_ROUNDS
export const LEAGUE_SIZE_MIN = 8
export const LEAGUE_SIZE_MAX = 16
export const LEAGUE_ROUNDS_MIN = 10
export const LEAGUE_ROUNDS_MAX = 15

export type LeagueBoardSettings = {
  teams: number
  rounds: number
  threeRr: boolean
}

export const DEFAULT_LEAGUE_SETTINGS: LeagueBoardSettings = {
  teams: DRAFT_TEAMS,
  rounds: DRAFT_ROUNDS,
  threeRr: true,
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function clampLeagueSettings(raw?: Partial<LeagueBoardSettings> | null): LeagueBoardSettings {
  return {
    teams: clampInt(raw?.teams ?? DEFAULT_LEAGUE_SETTINGS.teams, LEAGUE_SIZE_MIN, LEAGUE_SIZE_MAX),
    rounds: clampInt(raw?.rounds ?? DEFAULT_LEAGUE_SETTINGS.rounds, LEAGUE_ROUNDS_MIN, LEAGUE_ROUNDS_MAX),
    threeRr: raw?.threeRr !== false,
  }
}

export type DraftBoardPick<T> = {
  player: T
  pick: number
  team: number
  round: number
  pickInRound: number
}

export function annotateDraftPicks<T>(
  players: T[],
  teams = DRAFT_TEAMS,
  threeRr = true,
): DraftBoardPick<T>[] {
  return players.map((player, i) => ({
    player,
    pick: i + 1,
    team: draftTeamForPick(i + 1, teams, threeRr),
    round: Math.floor(i / teams) + 1,
    pickInRound: (i % teams) + 1,
  }))
}

export function threeRrDisplayRounds<T>(picks: DraftBoardPick<T>[], teams = DRAFT_TEAMS): DraftBoardPick<T>[][] {
  return chunkRows(picks, teams).map((round) => [...round].sort((a, b) => a.pick - b.pick))
}

export function groupDraftPicksByTeam<T>(
  picks: DraftBoardPick<T>[],
  teams = DRAFT_TEAMS,
): { team: number; picks: DraftBoardPick<T>[] }[] {
  const groups = Array.from({ length: teams }, (_, i) => ({ team: i + 1, picks: [] as DraftBoardPick<T>[] }))
  for (const pick of picks) {
    const group = groups[pick.team - 1]
    if (group) group.picks.push(pick)
  }
  for (const group of groups) group.picks.sort((a, b) => a.pick - b.pick)
  return groups
}

export function chunkRows<T>(players: T[], size: number): T[][] {
  if (size <= 0) return players.length ? [players] : []
  const rows: T[][] = []
  for (let i = 0; i < players.length; i += size) {
    rows.push(players.slice(i, i + size))
  }
  return rows
}

const EMPTY_SITE = { adp: null, rank: null, ranking: null }

export function hydrateAdpPlayer(index: AdpIndexPlayer, full?: AdpPlayer): AdpPlayer {
  if (full) return full
  return {
    id: index.id,
    espn_id: index.espn_id,
    name: index.name,
    team: null,
    team_abbr: index.team_abbr,
    photo_url: null,
    positions: index.positions,
    espn: EMPTY_SITE,
    fantrax: EMPTY_SITE,
    sleeper: EMPTY_SITE,
    yahoo: EMPTY_SITE,
    blend: index.blend,
    blend_rank: index.blend_rank,
    spread: null,
    ranking_blend: index.ranking_blend,
    ranking_blend_rank: index.ranking_blend_rank,
    ranking_spread: null,
    last_year: null,
    projection: null,
  }
}

export function shortSeasonLabel(label?: string | null): string {
  const match = label?.match(/^(\d{2})(\d{2})-(\d{2})$/)
  if (!match) return label || ''
  return `${match[2]}/${match[3]}`
}

export function nextShortSeasonLabel(label?: string | null, fallback = '26/27'): string {
  const match = label?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return fallback
  const start = Number(match[1]) + 1
  const end = String((Number(match[2]) + 1) % 100).padStart(2, '0')
  return `${String(start).slice(2)}/${end}`
}
