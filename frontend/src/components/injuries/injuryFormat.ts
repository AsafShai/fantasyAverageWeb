import { useMemo } from 'react'
import { useGetNbaTeamsListQuery } from '../../store/api/fantasyApi'
import type { InjuryRecord, StoredNotification } from '../../types/injury'

export function fmtTimestamp(ts: string): string {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString()
}

export const STATUS_ORDER: Record<string, number> = {
  'Out': 0, 'Doubtful': 1, 'Questionable': 2, 'Probable': 3, 'Available': 4,
}

export function parseGameParts(r: InjuryRecord): { gameTime: string; matchup: string; gameTimeMs: number } {
  const matchup = r.game.match(/\S+@\S+/)?.[0] ?? ''
  if (r.game_time_utc) {
    const d = new Date(r.game_time_utc)
    const datePart = d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
    const timePart = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return { gameTime: `${datePart} ${timePart}`, matchup, gameTimeMs: d.getTime() }
  }
  return { gameTime: '', matchup: r.game || '—', gameTimeMs: 0 }
}

export type InjurySortKey = 'team' | 'gameTime' | 'status' | 'last_update'
export type InjurySortDir = 'asc' | 'desc'

export function sortInjuries(records: InjuryRecord[], sortKey: InjurySortKey, sortDir: InjurySortDir): InjuryRecord[] {
  const dir = sortDir === 'asc' ? 1 : -1
  return [...records].sort((a, b) => {
    switch (sortKey) {
      case 'team': return dir * a.team.localeCompare(b.team)
      case 'gameTime': {
        const aMs = a.game_time_utc ? new Date(a.game_time_utc).getTime() : 0
        const bMs = b.game_time_utc ? new Date(b.game_time_utc).getTime() : 0
        return dir * (aMs - bMs)
      }
      case 'status': return dir * ((STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
      case 'last_update': return dir * a.last_update.localeCompare(b.last_update)
      default: return 0
    }
  })
}

/** NBA team name → depth chart team id, for the Roster link. */
export function useDepthChartTeamId() {
  const { data: nbaTeams } = useGetNbaTeamsListQuery()
  return useMemo(() => {
    // Match on letters and digits only, so a team name that lost a space while being
    // parsed from the PDF (once "Philadelphia76ers") still links.
    const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    const byName = new Map<string, string>()
    for (const team of nbaTeams ?? []) {
      byName.set(key(team.team_name), team.team_id)
    }
    return (name: string) => byName.get(key(name))
  }, [nbaTeams])
}

export function formatNotification(notif: StoredNotification): string {
  switch (notif.type) {
    case 'status_change':
      return `${notif.player} (${notif.team}): ${notif.old_status} → ${notif.new_status}`
    case 'added':
      return `${notif.player} (${notif.team}): Added — ${notif.new_status}`
    case 'removed':
      return `${notif.player} (${notif.team}): Removed`
    default:
      return `${notif.player} (${notif.team})`
  }
}

export function notificationIcon(type: StoredNotification['type']): string {
  switch (type) {
    case 'status_change': return '🔄'
    case 'added': return '➕'
    case 'removed': return '➖'
    default: return '📋'
  }
}
