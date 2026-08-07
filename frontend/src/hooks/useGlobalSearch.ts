import { useMemo } from 'react'
import { useGetAllPlayersQuery, useGetTeamsListQuery, useGetNbaTeamsListQuery } from '../store/api/fantasyApi'
import { SEARCHABLE_PAGES } from '../constants/searchablePages'
import type { Player, Team, NbaTeamInfo } from '../types/api'
import type { SearchablePage } from '../constants/searchablePages'

export type SearchResultGroup = 'Players' | 'Fantasy teams' | 'NBA teams' | 'Pages'

export interface SearchResult {
  group: SearchResultGroup
  key: string
  icon: string
  title: string
  subtitle: string
  path: string
  badge?: { label: string; tone: 'fa' | 'out' }
}

const MAX_PER_GROUP = 6

/** exact-prefix (3) > word-start match (2) > substring (1) > no match (0) */
function matchScore(text: string, query: string): number {
  if (!query) return 1
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  if (t.startsWith(q)) return 3
  if (t.split(/[\s-]+/).some((word) => word.startsWith(q))) return 2
  if (t.includes(q)) return 1
  return 0
}

function bestScore(texts: string[], query: string): number {
  return Math.max(0, ...texts.map((t) => matchScore(t, query)))
}

function rankAndCap<T>(items: Array<{ item: T; score: number }>, cap: number): T[] {
  return items
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((x) => x.item)
}

function playerOwnerText(player: Player): string {
  if (player.status === 'FREEAGENT') return 'Free Agent'
  if (player.status === 'WAIVERS') return 'Waivers'
  return player.fantasy_team_name || 'On a team'
}

function toPlayerResult(player: Player): SearchResult {
  const badge: SearchResult['badge'] = player.injured
    ? { label: 'OUT', tone: 'out' }
    : player.status === 'FREEAGENT'
      ? { label: 'FA', tone: 'fa' }
      : undefined
  return {
    group: 'Players',
    key: `player-${player.player_name}`,
    icon: '🏀',
    title: player.player_name,
    subtitle: `${player.pro_team} · ${player.positions.join('/')} · ${playerOwnerText(player)}`,
    path: player.player_id != null ? `/player/${player.player_id}` : '',
    badge,
  }
}

function toTeamResult(team: Team): SearchResult {
  return {
    group: 'Fantasy teams',
    key: `team-${team.team_id}`,
    icon: '👥',
    title: team.team_name,
    subtitle: `Fantasy team #${team.team_id}`,
    path: `/team/${team.team_id}`,
  }
}

function toNbaTeamResult(team: NbaTeamInfo): SearchResult {
  return {
    group: 'NBA teams',
    key: `nba-${team.team_id}`,
    icon: '🏟️',
    title: team.team_name,
    subtitle: team.abbreviation,
    path: `/nba-teams?team=${encodeURIComponent(team.team_id)}`,
  }
}

function toPageResult(page: SearchablePage): SearchResult {
  return {
    group: 'Pages',
    key: `page-${page.path}`,
    icon: page.icon,
    title: page.label,
    subtitle: page.group,
    path: page.path,
  }
}

/**
 * Merges players / fantasy teams / NBA teams / static pages into one ranked,
 * grouped result list. Reuses whatever's already in the RTK Query cache
 * (same query args as Players.tsx / Teams.tsx / NbaTeams.tsx) rather than
 * issuing new fetches.
 */
export function useGlobalSearch(query: string) {
  const { data: playersData, isFetching: playersLoading } = useGetAllPlayersQuery({
    page: 1,
    limit: 1200,
    time_period: 'season',
  })
  const { data: teams, isFetching: teamsLoading } = useGetTeamsListQuery()
  const { data: nbaTeams, isFetching: nbaTeamsLoading } = useGetNbaTeamsListQuery()

  const trimmed = query.trim()

  const results = useMemo(() => {
    const players = playersData?.players ?? []

    const playerResults = rankAndCap(
      players.map((p) => ({
        item: p,
        score: bestScore([p.player_name], trimmed),
      })),
      MAX_PER_GROUP
    ).map(toPlayerResult)

    const teamResults = rankAndCap(
      (teams ?? []).map((t) => ({
        item: t,
        score: bestScore([t.team_name], trimmed),
      })),
      MAX_PER_GROUP
    ).map(toTeamResult)

    const nbaTeamResults = rankAndCap(
      (nbaTeams ?? []).map((t) => ({
        item: t,
        score: bestScore([t.team_name, t.abbreviation], trimmed),
      })),
      MAX_PER_GROUP
    ).map(toNbaTeamResult)

    const pageResults = rankAndCap(
      SEARCHABLE_PAGES.map((p) => ({
        item: p,
        score: bestScore([p.label, p.group], trimmed),
      })),
      MAX_PER_GROUP
    ).map(toPageResult)

    return [...playerResults, ...teamResults, ...nbaTeamResults, ...pageResults]
  }, [playersData, teams, nbaTeams, trimmed])

  const groups = useMemo(() => {
    const order: SearchResultGroup[] = ['Players', 'Fantasy teams', 'NBA teams', 'Pages']
    return order
      .map((group) => ({ group, items: results.filter((r) => r.group === group) }))
      .filter((g) => g.items.length > 0)
  }, [results])

  return {
    results,
    groups,
    isLoading: trimmed.length > 0 && (playersLoading || teamsLoading || nbaTeamsLoading) && results.length === 0,
  }
}

export function highlightMatch(text: string, query: string): { before: string; match: string; after: string } | null {
  if (!query) return null
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return null
  return {
    before: text.slice(0, idx),
    match: text.slice(idx, idx + query.length),
    after: text.slice(idx + query.length),
  }
}
