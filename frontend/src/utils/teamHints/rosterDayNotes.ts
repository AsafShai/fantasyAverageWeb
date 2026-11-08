import type { RosterDay, RosterDayPlayer } from '../../types/api'

export function rosterDayPlayer(
  playerId: number | null | undefined,
  rosterDay?: RosterDay | null,
): RosterDayPlayer | undefined {
  if (playerId == null || !rosterDay?.players?.length) return undefined
  return rosterDay.players.find((p) => p.player_id === playerId)
}

/** True when hints can use today's lineup lock / schedule. */
export function lineupHintsDayActive(rosterDay?: RosterDay | null): boolean {
  return Boolean(rosterDay?.has_games && rosterDay.players?.length)
}

export function playsTonight(playerId: number | null | undefined, rosterDay?: RosterDay | null): boolean {
  const dayPlayer = rosterDayPlayer(playerId, rosterDay)
  return Boolean(dayPlayer?.status === 'scheduled' && dayPlayer.opponent)
}

/** `Tonight vs {OPP}` when the player is scheduled on the current roster day. */
export function tonightGameNoteForPlayer(
  playerId: number | null | undefined,
  rosterDay?: RosterDay | null,
): string | null {
  if (!playsTonight(playerId, rosterDay)) return null
  const dayPlayer = rosterDayPlayer(playerId, rosterDay)
  return dayPlayer?.opponent ? `Tonight vs ${dayPlayer.opponent}` : null
}
