import { useMemo } from 'react'
import type { MinigamePlayer } from './types'

export type ConferenceDivisionTeam = { name: string; abbr: string }
export type ConferenceDivisionColumn = {
  division: string
  teams: ConferenceDivisionTeam[]
}

export type ConferenceDivisionTree = {
  East: ConferenceDivisionColumn[]
  West: ConferenceDivisionColumn[]
}

const ORDER_EAST = ['Atlantic', 'Central', 'Southeast'] as const
const ORDER_WEST = ['Northwest', 'Pacific', 'Southwest'] as const

function sortDivName(divs: string[], order: readonly string[]): string[] {
  return [...divs].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}

/** Build East/West → division → teams tree from roster (dedupe by franchise name). */
export function buildConferenceDivisionTree(players: MinigamePlayer[]): ConferenceDivisionTree {
  if (!players.length) {
    return { East: [], West: [] }
  }
  const east = new Map<string, Map<string, string>>()
  const west = new Map<string, Map<string, string>>()
  for (const p of players) {
    const target = p.conference === 'East' ? east : p.conference === 'West' ? west : null
    if (!target) continue
    if (!target.has(p.division)) target.set(p.division, new Map())
    target.get(p.division)!.set(p.team, p.teamAbbr)
  }
  function pack(
    m: Map<string, Map<string, string>>,
    order: readonly string[],
  ): ConferenceDivisionColumn[] {
    return sortDivName([...m.keys()], order).map((division) => {
      const byTeam = m.get(division)!
      const teams = [...byTeam.entries()]
        .map(([name, abbr]) => ({ name, abbr }))
        .sort((a, b) => a.name.localeCompare(b.name))
      return { division, teams }
    })
  }
  return {
    East: pack(east, ORDER_EAST),
    West: pack(west, ORDER_WEST),
  }
}

export function useConferenceDivisionTree(players: MinigamePlayer[]): ConferenceDivisionTree {
  return useMemo(() => buildConferenceDivisionTree(players), [players])
}

/** ESPN CDN slug differs from common NBA abbrs for a few franchises. */
const ESPN_LOGO_SLUG: Record<string, string> = {
  UTA: 'utah',
  NOP: 'no',
  NYK: 'ny',
  GSW: 'gs',
  SAS: 'sa',
  WAS: 'wsh',
}

/** ESPN team logo by roster abbreviation. */
export function nbaTeamLogoUrl(abbr: string): string {
  const key = abbr.trim().toUpperCase()
  const slug = ESPN_LOGO_SLUG[key] ?? key.toLowerCase()
  return `https://a.espncdn.com/i/teamlogos/nba/500/${slug}.png`
}
