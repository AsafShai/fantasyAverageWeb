import { isPlayerOutOnInjuryReport, isProTeamOnInjuryReport } from '../../playerInjury'
import type { HintPlayerLine, TeamHint, TeamHintsInput } from '../types'
import { buildHintPlayerLine } from '../playerReasons'

const MAX_IR_PLAYERS = 6

function playerLines(
  rosterPlayers: TeamHintsInput['teamDetail']['players'],
  input: TeamHintsInput,
): HintPlayerLine[] {
  const injuryMap = input.injuryStatusByPlayerName
  return (rosterPlayers ?? []).slice(0, MAX_IR_PLAYERS).map((p) =>
    buildHintPlayerLine(p, input.ranks, injuryMap),
  )
}

export function detectRosterHints(input: TeamHintsInput): TeamHint[] {
  const players = input.teamDetail.players ?? []
  if (players.length === 0) return []
  const hints: TeamHint[] = []
  const injuryMap = input.injuryStatusByPlayerName
  const reportTeamKeys = input.injuryReportTeamKeys ?? new Set<string>()
  const nbaTeams = input.nbaTeams
  const irNoLongerOut = players.filter(
    (p) =>
      p.lineup_slot === 'IR' &&
      !isPlayerOutOnInjuryReport(p, injuryMap) &&
      isProTeamOnInjuryReport(p.pro_team, reportTeamKeys, nbaTeams),
  )
  if (irNoLongerOut.length > 0) {
    const lines = playerLines(irNoLongerOut, input)
    hints.push({
      id: 'roster-ir-not-out',
      category: 'roster',
      severity: 'warning',
      priority: 44,
      title: 'Review IR slot',
      body:
        lines.length === 1
          ? 'This player is on IR but is not Out on the injury report — they may play soon; consider moving them off IR.'
          : 'These players are on IR but are not Out on the injury report — they may play soon; consider moving them off IR.',
      players: lines,
      playerIds: lines.map((l) => l.playerId).filter((id): id is number => id != null),
    })
  }

  const irOccupied = players.some((p) => p.lineup_slot === 'IR')
  if (!irOccupied) {
    const outActive = players.filter(
      (p) => p.lineup_slot !== 'IR' && isPlayerOutOnInjuryReport(p, injuryMap),
    )
    if (outActive.length > 0) {
      const lines = playerLines(outActive, input)
      hints.push({
        id: 'roster-ir-fill-empty',
        category: 'roster',
        severity: 'opportunity',
        priority: 46,
        title: 'Use open IR slot',
        body:
          lines.length === 1
            ? 'Your IR slot is empty and this player is Out — consider moving them to IR to free an active roster spot.'
            : 'Your IR slot is empty and these players are Out — consider moving one to IR to free an active roster spot.',
        players: lines,
        playerIds: lines.map((l) => l.playerId).filter((id): id is number => id != null),
      })
    }
  }

  return hints
}
