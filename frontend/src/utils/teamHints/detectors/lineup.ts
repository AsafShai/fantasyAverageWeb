import { isPlayerOutOnInjuryReport } from '../../playerInjury'
import { rankForPlayer } from '../ranks'
import {
  BENCH_HOT_MAX_RANK,
  FORM_RANK_DELTA,
  SEASON_STARTER_POOR_MIN,
  STARTER_COLD_MIN_RANK,
} from '../thresholds'
import type { HintPlayerLine, RosterPlayer, TeamHint, TeamHintsInput } from '../types'
import {
  buildHintPlayerLine,
  coolingReason,
  hasLineupValueExplanation,
  heatingReason,
  strongL15StartExplanation,
} from '../playerReasons'
import { benchPlayers, injuredStarters, isStarterSlot } from '../lineupSlots'
import { lineupHintsDayActive, playsTonight, tonightGameNoteForPlayer } from '../rosterDayNotes'

const MAX_PLAYERS_PER_GROUP = 6

function playerLine(player: RosterPlayer, notes: string[], input: TeamHintsInput): HintPlayerLine {
  return buildHintPlayerLine(player, input.ranks, input.injuryStatusByPlayerName, notes)
}

function groupedHint(
  id: string,
  title: string,
  severity: TeamHint['severity'],
  priority: number,
  body: string,
  players: HintPlayerLine[],
): TeamHint | null {
  if (players.length === 0) return null
  return {
    id,
    category: 'lineup',
    severity,
    priority,
    title,
    body,
    players,
    playerIds: players.map((p) => p.playerId).filter((x): x is number => x != null),
  }
}

export function detectLineupHints(input: TeamHintsInput): TeamHint[] {
  const players = input.teamDetail.players ?? []
  if (players.length === 0) return []
  const { ranks } = input
  const injuryMap = input.injuryStatusByPlayerName
  const hints: TeamHint[] = []
  const rosterDay = input.rosterDay
  const todayLineup = lineupHintsDayActive(rosterDay)

  if (todayLineup) {
    const startCandidates: { player: (typeof players)[0]; priority: number; notes: string[] }[] = []
    for (const p of benchPlayers(players)) {
      if (!playsTonight(p.player_id, rosterDay)) continue
      if (isPlayerOutOnInjuryReport(p, injuryMap)) continue
      const l15 = rankForPlayer(ranks, p, 'last_15')
      if (!l15) continue
      const notes: string[] = []
      const gameNote = tonightGameNoteForPlayer(p.player_id, rosterDay)
      if (gameNote) notes.push(gameNote)
      const heat = heatingReason(p, ranks, FORM_RANK_DELTA)
      if (heat) notes.push(heat)
      const hotL15 = l15.rank <= BENCH_HOT_MAX_RANK
      if (!hotL15 && !heat) continue
      if (!hasLineupValueExplanation(notes)) {
        notes.push(strongL15StartExplanation(l15))
      }
      const priority = 80 + Math.max(0, BENCH_HOT_MAX_RANK - l15.rank)
      startCandidates.push({ player: p, priority, notes })
    }
    startCandidates.sort((a, b) => b.priority - a.priority)
    const seenStart = new Set<number | string>()
    const startLines: HintPlayerLine[] = []
    for (const c of startCandidates) {
      const key = c.player.player_id ?? c.player.player_name
      if (seenStart.has(key)) continue
      seenStart.add(key)
      startLines.push(playerLine(c.player, c.notes, input))
      if (startLines.length >= MAX_PLAYERS_PER_GROUP) break
    }
    const startHint = groupedHint(
      'lineup-consider-starting',
      'Consider starting',
      'opportunity',
      startLines.length ? 92 : 0,
      'Bench players with a game tonight worth a lineup look.',
      startLines,
    )
    if (startHint) hints.push(startHint)

    const benchCandidates: { player: (typeof players)[0]; priority: number; notes: string[] }[] = []
    for (const p of players.filter((x) => isStarterSlot(x.lineup_slot))) {
      if (!playsTonight(p.player_id, rosterDay)) continue
      const season = rankForPlayer(ranks, p, 'season')
      const notes: string[] = []
      const gameNote = tonightGameNoteForPlayer(p.player_id, rosterDay)
      if (gameNote) notes.push(gameNote)
      const cool = coolingReason(p, ranks, FORM_RANK_DELTA, STARTER_COLD_MIN_RANK)
      if (cool) notes.push(cool)
      const weakSeason = season && season.rank >= SEASON_STARTER_POOR_MIN
      if (!weakSeason && !cool) continue
      if (weakSeason && season) {
        notes.push(`Season value is weak for a starter (${season.rank} among qualified players)`)
      }
      const priority =
        (weakSeason ? 70 + Math.min(20, season!.rank - SEASON_STARTER_POOR_MIN) : 0) + (cool ? 15 : 0)
      benchCandidates.push({ player: p, priority, notes })
    }
    benchCandidates.sort((a, b) => b.priority - a.priority)
    const seenBench = new Set<number | string>()
    const benchLines: HintPlayerLine[] = []
    for (const c of benchCandidates) {
      const key = c.player.player_id ?? c.player.player_name
      if (seenBench.has(key)) continue
      seenBench.add(key)
      benchLines.push(playerLine(c.player, c.notes, input))
      if (benchLines.length >= MAX_PLAYERS_PER_GROUP) break
    }
    const benchHint = groupedHint(
      'lineup-consider-benching',
      'Consider benching',
      'warning',
      benchLines.length ? 85 : 0,
      'Starters with a game tonight who may be worth moving to your bench.',
      benchLines,
    )
    if (benchHint) hints.push(benchHint)
  }

  const injured = injuredStarters(players, injuryMap)
  const injuredLines: HintPlayerLine[] = injured.map((p) => {
    const notes: string[] = []
    const game = tonightGameNoteForPlayer(p.player_id, rosterDay)
    if (game) notes.push(game)
    return playerLine(p, notes, input)
  })
  const injuryHint = groupedHint(
    'lineup-injured-starters',
    'Injured starters',
    'warning',
    injuredLines.length ? 96 : 0,
    'Starters who are on the injury report.',
    injuredLines,
  )
  if (injuryHint) hints.push(injuryHint)

  return hints
}
