import type { Player } from '../../types/api'
import type { SlateLine, SlatePlayerValue, SlateValues } from '../../types/boxScore'
import { computePlayerRankings, scoreAgainstPool, type RankingsConfig } from '../../utils/playerRankings'

/** A box-score line in the shape the Player Rankings page ranks: one game
 * played (none for a 0-minute line), its numbers in the generic stats dict. */
function asPlayer(line: SlateLine): Player {
  const s = line.stats
  const minutes = s.MIN ?? 0
  return {
    player_name: line.name,
    pro_team: line.team_abbr,
    positions: line.position ? [line.position] : [],
    team_id: 0,
    status: 'FREEAGENT',
    player_id: Number(line.player_id) || null,
    stats: {
      pts: s.PTS ?? 0, reb: s.REB ?? 0, ast: s.AST ?? 0, stl: s.STL ?? 0, blk: s.BLK ?? 0,
      fgm: s.FGM ?? 0, fga: s.FGA ?? 0, ftm: s.FTM ?? 0, fta: s.FTA ?? 0,
      fg_percentage: s['FG%'] ?? 0, ft_percentage: s['FT%'] ?? 0, three_pm: s['3PM'] ?? 0,
      minutes, gp: minutes > 0 ? 1 : 0,
      stats: s,
    },
  }
}

/**
 * Every line's Z: the value the Player Rankings page gives that night, from
 * the page's own code and default settings (per game, no minimums, equal
 * weights). The pool is the players who logged minutes, as in the page's
 * night; a line outside it (0 minutes, or below the top 300) is scored
 * against it with scoreAgainstPool, as the page scores such a player.
 * Highest Z first.
 */
export function slatePlayerValues(values: SlateValues): SlatePlayerValue[] {
  const { categories } = values
  if (categories.length === 0) return values.players.map(line => ({ ...line, z: 0 }))
  const reverse = new Set(values.reverse_categories)
  const weights = Object.fromEntries(categories.map(c => [c, 1]))
  const config: RankingsConfig = { calcMode: 'per_game', minGp: 0, minMin: 0, position: null, weights }

  const players = values.players.map(asPlayer)
  const played = players.filter(p => p.stats.minutes > 0)
  const ranked = computePlayerRankings(played, config, categories, reverse)
  const pool = ranked.map(r => r.player)
  const zOf = new Map(ranked.map(r => [r.player, r.totalZ]))

  return values.players
    .map((line, i) => {
      const player = players[i]
      const z = zOf.get(player) ?? (pool.length > 0
        ? scoreAgainstPool(player, pool, 'per_game', weights, categories, reverse)
        : 0)
      return { ...line, z }
    })
    .sort((a, b) => b.z - a.z)
}
