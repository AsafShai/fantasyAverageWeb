import { isPlayerOutOnInjuryReport } from '../../playerInjury'
import { rankForPlayer } from '../ranks'
import {
  CONSIDER_BENCH_L15_OUTSIDE_TOP,
  CONSIDER_BENCH_SEASON_OUTSIDE_TOP,
  CONSIDER_START_L15_MAX_RANK,
  CONSIDER_START_SEASON_MAX_RANK,
} from '../thresholds'
import type { HintPlayerLine, RosterPlayer, TeamHint, TeamHintsInput } from '../types'
import { buildHintPlayerLine, considerBenchRankNotes, considerStartRankNotes } from '../playerReasons'
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

function qualifiesConsiderStart(seasonRank: number | undefined, l15Rank: number | undefined): boolean {
  if (seasonRank != null && seasonRank <= CONSIDER_START_SEASON_MAX_RANK) return true
  if (l15Rank != null && l15Rank <= CONSIDER_START_L15_MAX_RANK) return true
  return false
}

function qualifiesConsiderBench(seasonRank: number | undefined, l15Rank: number | undefined): boolean {
  if (seasonRank != null && seasonRank > CONSIDER_BENCH_SEASON_OUTSIDE_TOP) return true
  if (l15Rank != null && l15Rank > CONSIDER_BENCH_L15_OUTSIDE_TOP) return true
  return false
}

function startSortPriority(seasonRank: number | undefined, l15Rank: number | undefined): number {
  const good: number[] = []
  if (seasonRank != null && seasonRank <= CONSIDER_START_SEASON_MAX_RANK) good.push(seasonRank)
  if (l15Rank != null && l15Rank <= CONSIDER_START_L15_MAX_RANK) good.push(l15Rank)
  if (good.length === 0) return 0
  return 1000 - Math.min(...good)
}

function benchSortPriority(seasonRank: number | undefined, l15Rank: number | undefined): number {
  const bad: number[] = []
  if (seasonRank != null && seasonRank > CONSIDER_BENCH_SEASON_OUTSIDE_TOP) bad.push(seasonRank)
  if (l15Rank != null && l15Rank > CONSIDER_BENCH_L15_OUTSIDE_TOP) bad.push(l15Rank)
  return bad.length ? Math.max(...bad) : 0
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
      const season = rankForPlayer(ranks, p, 'season')
      const l15 = rankForPlayer(ranks, p, 'last_15')
      const seasonRank = season?.rank
      const l15Rank = l15?.rank
      if (!qualifiesConsiderStart(seasonRank, l15Rank)) continue
      const notes: string[] = []
      const gameNote = tonightGameNoteForPlayer(p.player_id, rosterDay)
      if (gameNote) notes.push(gameNote)
      notes.push(...considerStartRankNotes(season, l15, CONSIDER_START_SEASON_MAX_RANK, CONSIDER_START_L15_MAX_RANK))
      startCandidates.push({
        player: p,
        priority: startSortPriority(seasonRank, l15Rank),
        notes,
      })
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
      const l15 = rankForPlayer(ranks, p, 'last_15')
      const seasonRank = season?.rank
      const l15Rank = l15?.rank
      if (!qualifiesConsiderBench(seasonRank, l15Rank)) continue
      const notes: string[] = []
      const gameNote = tonightGameNoteForPlayer(p.player_id, rosterDay)
      if (gameNote) notes.push(gameNote)
      notes.push(
        ...considerBenchRankNotes(season, l15, CONSIDER_BENCH_SEASON_OUTSIDE_TOP, CONSIDER_BENCH_L15_OUTSIDE_TOP),
      )
      benchCandidates.push({
        player: p,
        priority: benchSortPriority(seasonRank, l15Rank),
        notes,
      })
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
