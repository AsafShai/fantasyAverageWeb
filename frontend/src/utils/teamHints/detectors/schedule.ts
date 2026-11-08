import { isPlayerOutOnInjuryReport } from '../../playerInjury'
import { rankForPlayer } from '../ranks'
import { buildHintPlayerLine } from '../playerReasons'
import type { HintPlayerLine, TeamHint, TeamHintsInput } from '../types'

const MAX_PLAYERS = 6

export function detectScheduleHints(input: TeamHintsInput): TeamHint[] {
  const day = input.rosterDay
  if (!day?.players?.length) return []

  const injuryMap = input.injuryStatusByPlayerName
  const candidates = day.players.filter(
    (p) =>
      p.lineup_slot === 'BE' &&
      p.status === 'scheduled' &&
      Boolean(p.opponent) &&
      !isPlayerOutOnInjuryReport(p, injuryMap),
  )

  if (candidates.length === 0) return []

  const ranked = candidates
    .map((p) => ({
      p,
      l15: rankForPlayer(input.ranks, p, 'last_15'),
    }))
    .sort((a, b) => {
      const ar = a.l15?.rank ?? 9999
      const br = b.l15?.rank ?? 9999
      return ar - br
    })

  const players: HintPlayerLine[] = []
  for (const { p } of ranked) {
    const notes: string[] = []
    if (p.opponent) notes.push(`Tonight vs ${p.opponent}`)
    players.push(buildHintPlayerLine(p, input.ranks, injuryMap, notes))
    if (players.length >= MAX_PLAYERS) break
  }

  return [
    {
      id: 'schedule-bench-plays-tonight',
      category: 'schedule',
      severity: 'opportunity',
      priority: 78 + Math.min(8, players.length),
      title: 'Games tonight',
      body:
        players.length === 1
          ? 'This bench player has a game tonight.'
          : 'These bench players have a game tonight.',
      players,
      playerIds: players.map((pl) => pl.playerId).filter((id): id is number => id != null),
    },
  ]
}
