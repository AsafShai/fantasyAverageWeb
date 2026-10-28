import type { BoxPlayerLine, BoxTeamBox } from '../../types/boxScore'

/** A player fouls out of an NBA game with 6 personal fouls. */
export function fouledOut(pf: string): boolean {
  if (pf.trim() === '') return false
  const fouls = Number(pf)
  return Number.isFinite(fouls) && fouls >= 6
}

/**
 * Finished and upcoming games keep the tip-off split. A live game groups
 * whoever is on the floor right now ahead of everyone else who has checked in.
 */
export function lineupGroups(team: Pick<BoxTeamBox, 'starters' | 'bench'>, live: boolean): { label: string; players: BoxPlayerLine[] }[] {
  if (!live) {
    return [
      { label: 'Starters', players: team.starters },
      { label: 'Bench', players: team.bench },
    ].filter(group => group.players.length > 0)
  }
  const played = [...team.starters, ...team.bench]
  return [
    { label: 'On the court', players: played.filter(player => player.on_court) },
    { label: 'Bench', players: played.filter(player => !player.on_court) },
  ].filter(group => group.players.length > 0)
}
