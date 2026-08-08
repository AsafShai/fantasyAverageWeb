import type { MinigamePlayer, NbaTeamOption } from './types'

export function findPlayerById(players: MinigamePlayer[], id: string): MinigamePlayer | undefined {
  return players.find((p) => p.id === id)
}

export function pickRandomPlayer(players: MinigamePlayer[], excludeId?: string | null): MinigamePlayer {
  const pool =
    excludeId && players.length > 1 ? players.filter((p) => p.id !== excludeId) : players
  const use = pool.length > 0 ? pool : players
  return use[Math.floor(Math.random() * use.length)]
}

export function buildNbaTeamOptions(players: MinigamePlayer[]): NbaTeamOption[] {
  const map = new Map<string, string>()
  for (const p of players) {
    if (!map.has(p.teamAbbr)) map.set(p.teamAbbr, p.team)
  }
  return Array.from(map.entries())
    .map(([abbr, label]) => ({ abbr, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'))
}

export function playersWithPhotos(players: MinigamePlayer[]): MinigamePlayer[] {
  return players.filter((p) => p.photoUrl != null && String(p.photoUrl).trim().length > 0)
}

export function pickRandomPlayerWithPhoto(
  players: MinigamePlayer[],
  excludeId?: string | null,
): MinigamePlayer {
  const withPhotos = playersWithPhotos(players)
  if (withPhotos.length === 0) throw new Error('No players with photos in bundle')
  return pickRandomPlayer(withPhotos, excludeId)
}
