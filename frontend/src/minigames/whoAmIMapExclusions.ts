import type { MinigamePlayer, WhoAmIGuessRow } from './types'

const OTHER_CONF: Record<'East' | 'West', 'East' | 'West'> = {
  East: 'West',
  West: 'East',
}

const DIVS_EAST = ['Atlantic', 'Central', 'Southeast'] as const
const DIVS_WEST = ['Northwest', 'Pacific', 'Southwest'] as const

function divisionPeers(conference: 'East' | 'West', division: string): string[] {
  const all = conference === 'East' ? [...DIVS_EAST] : [...DIVS_WEST]
  return all.filter((d) => d !== division)
}

/**
 * Conferences, divisions, and team franchises the mystery player cannot be in,
 * from Team / Conference / Division cell feedback only.
 * For the reference map — not for disabling players in the picker.
 */
export type WhoAmIMapExclusions = {
  excludedConferences: Set<'East' | 'West'>
  excludedDivisions: Set<string>
  /** Franchise names as in `MinigamePlayer.team`. */
  excludedTeams: Set<string>
}

export function emptyWhoAmIMapExclusions(): WhoAmIMapExclusions {
  return {
    excludedConferences: new Set(),
    excludedDivisions: new Set(),
    excludedTeams: new Set(),
  }
}

export function computeWhoAmIMapExclusions(
  players: MinigamePlayer[],
  guessRows: WhoAmIGuessRow[] | null | undefined,
): WhoAmIMapExclusions {
  const excludedConferences = new Set<'East' | 'West'>()
  const excludedDivisions = new Set<string>()
  const excludedTeams = new Set<string>()

  const byId = new Map(players.map((p) => [p.id, p] as const))
  const allFranchises = new Set(players.map((p) => p.team))

  for (const gr of guessRows ?? []) {
    const g = byId.get(gr.guessedPlayerId)
    if (!g) continue
    if (g.conference !== 'East' && g.conference !== 'West') continue

    const f = gr.feedback

    if (f.conference.state === 'correct') {
      excludedConferences.add(OTHER_CONF[g.conference])
    } else if (f.conference.state === 'wrong') {
      excludedConferences.add(g.conference)
    }

    if (f.division.state === 'correct') {
      for (const d of divisionPeers(g.conference, g.division)) {
        excludedDivisions.add(d)
      }
    } else if (f.division.state === 'wrong') {
      excludedDivisions.add(g.division)
    }

    if (f.team.state === 'correct') {
      for (const t of allFranchises) {
        if (t !== g.team) excludedTeams.add(t)
      }
    } else if (f.team.state === 'wrong') {
      excludedTeams.add(g.team)
    }
  }

  return { excludedConferences, excludedDivisions, excludedTeams }
}
