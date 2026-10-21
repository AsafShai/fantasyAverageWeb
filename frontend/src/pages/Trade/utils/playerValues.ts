import type { Player } from '../../../types/api';
import {
  computePlayerRankings,
  scoreAgainstPool,
  DEFAULT_CATEGORIES,
  type RankingCategory,
} from '../../../utils/playerRankings';

/** A player's place among every player over the same dates, scored the way
 * Player Rankings scores by default (per game, equal weights). */
export interface PlayerValue {
  rank: number;
  /** How many players were ranked. */
  of: number;
  z: number;
}

export type PlayerValueLookup = (player: Player) => PlayerValue | undefined;

const keyOf = (player: Pick<Player, 'player_id' | 'player_name'>) =>
  player.player_id != null ? `id:${player.player_id}` : `name:${player.player_name}`;

/**
 * Rank and z-score every player with data in `players`. The top 300 (the
 * ranking's reference pool) get the same z-score and rank Player Rankings
 * shows; everyone else is scored against that pool and ranked below them.
 */
export function computePlayerValues(
  players: Player[],
  categories: RankingCategory[] = DEFAULT_CATEGORIES,
  reverseCategories: Set<RankingCategory> = new Set(),
): Map<string, PlayerValue> {
  const pool = players.filter(p => p.has_data !== false && p.stats.gp > 0);
  const weights = Object.fromEntries(categories.map(c => [c, 1]));
  const ranked = computePlayerRankings(
    pool, { calcMode: 'per_game', minGp: 0, minMin: 0, position: null, weights }, categories, reverseCategories,
  );
  if (ranked.length === 0) return new Map();

  const referencePool = ranked.map(r => r.player);
  const inPool = new Set(referencePool.map(keyOf));
  const scored = [
    ...ranked.map(r => ({ player: r.player, z: r.totalZ })),
    ...pool
      .filter(p => !inPool.has(keyOf(p)))
      .map(p => ({ player: p, z: scoreAgainstPool(p, referencePool, 'per_game', weights, categories, reverseCategories) })),
  ].sort((a, b) => b.z - a.z);

  const values = new Map<string, PlayerValue>();
  scored.forEach(({ player, z }, i) => {
    const value = { rank: i + 1, of: scored.length, z };
    values.set(keyOf(player), value);
    // Name fallback for a roster row that lacks the id.
    const byName = `name:${player.player_name}`;
    if (!values.has(byName)) values.set(byName, value);
  });
  return values;
}

/** Look a player up by ESPN id, falling back to the name. */
export function playerValueLookup(values: Map<string, PlayerValue>): PlayerValueLookup {
  return player => values.get(keyOf(player)) ?? values.get(`name:${player.player_name}`);
}

/** Mean z-score of the players that have one; null when none do. */
export function averageZ(players: Player[], playerValue?: PlayerValueLookup): number | null {
  const scores = players.map(p => playerValue?.(p)?.z).filter((z): z is number => z !== undefined);
  return scores.length === 0 ? null : scores.reduce((sum, z) => sum + z, 0) / scores.length;
}
