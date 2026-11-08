import type { Player, ScheduleResponse } from '../types/api'
import { isBackToBackGameDay } from './slateWindow'

export interface RosterDayCoverage {
  count: number
  b2bCount: number
}

export function teamsPlayingOnDate(schedule: ScheduleResponse | undefined, dayDate: string): Set<string> {
  return new Set(
    (schedule?.teams ?? [])
      .filter((team) => team.games.some((game) => game.date === dayDate))
      .map((team) => team.abbreviation),
  )
}

export function rosterDayCoverage(
  roster: Player[],
  playingTeams: Set<string>,
  dayDate: string,
  opponents: Map<string, string>,
): RosterDayCoverage {
  const playing = roster.filter((player) => playingTeams.has(player.pro_team))
  const b2bCount = playing.filter((p) => isBackToBackGameDay(opponents, p.pro_team, dayDate)).length
  return { count: playing.length, b2bCount }
}

/**
 * Bar track fill height = share of roster playing. Inside that fill, B2B is the
 * bottom band (amber); the rest of the band is normal games (blue).
 */
export function coverageBarPlayingSplit(
  rosterSize: number,
  count: number,
  b2bCount: number,
): { totalPct: number; b2bInsidePct: number; nonB2bInsidePct: number } {
  if (rosterSize <= 0 || count <= 0) {
    return { totalPct: 0, b2bInsidePct: 0, nonB2bInsidePct: 0 }
  }
  const safeB2b = Math.min(b2bCount, count)
  const nonB2b = count - safeB2b
  return {
    totalPct: (count / rosterSize) * 100,
    b2bInsidePct: (safeB2b / count) * 100,
    nonB2bInsidePct: (nonB2b / count) * 100,
  }
}
